import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  DigikalaIdentityConflictError,
  createDigikalaStandaloneOrchestrator,
  type DigikalaMongooseRepositories,
  type ProductDraftDocument,
  type ProductDraftInput,
  type PublicationInput,
  type PublicationDocument,
  type StandaloneVariantInput,
  type VariantDraftDocument,
  type VariantDraftInput,
} from '../src/index.js';

const productInput = {
  key: 'mug',
  details: {
    categoryId: 10707,
    brandId: 1,
    isIranian: false,
    model: 'Standalone Mug',
    packageLength: 12,
    packageWidth: 8,
    packageHeight: 10,
    packageWeight: 330,
  },
  title: { titleFa: 'ماگ سفید حالت مستقل' },
  images: [],
} satisfies ProductDraftInput;

const variantInput = {
  key: 'MUG-WHITE',
  input: {
    isActive: false,
    marketplaceSellerStock: 0,
    orderLimit: 2,
    warrantyId: 272,
    site: 'digikala',
    shippingType: 'digikala',
  },
} satisfies StandaloneVariantInput;

function fakeRepositories(): DigikalaMongooseRepositories {
  const products = new Map<string, ProductDraftDocument>();
  const variants = new Map<string, VariantDraftDocument>();
  const publications = new Map<string, PublicationDocument>();

  return {
    products: {
      async create(input: ProductDraftInput) {
        const document = {
          ...input,
          id: new Types.ObjectId().toString(),
        } as unknown as ProductDraftDocument;
        products.set(input.key, document);
        return document;
      },
      async findByKey(key: string) {
        return products.get(key) ?? null;
      },
    },
    variants: {
      async create(input: VariantDraftInput) {
        const document = {
          ...input,
          id: new Types.ObjectId().toString(),
          productId: new Types.ObjectId(input.productId),
        } as unknown as VariantDraftDocument;
        variants.set(input.key, document);
        return document;
      },
      async findByKey(key: string) {
        return variants.get(key) ?? null;
      },
    },
    publications: {
      async findForProduct(
        panelKey: string,
        productId: string | Types.ObjectId,
      ) {
        return (
          publications.get(`${panelKey}:${String(productId)}:product`) ?? null
        );
      },
      async findForVariant(
        panelKey: string,
        _productId: string | Types.ObjectId,
        variantId: string | Types.ObjectId,
      ) {
        void _productId;
        return publications.get(`${panelKey}:${String(variantId)}`) ?? null;
      },
      async upsert(input: PublicationInput) {
        const key = input.variantId
          ? `${input.panelKey}:${String(input.variantId)}`
          : `${input.panelKey}:${String(input.productId)}:product`;
        const document = {
          ...input,
          id: publications.get(key)?.id ?? new Types.ObjectId().toString(),
        } as unknown as PublicationDocument;
        publications.set(key, document);
        return document;
      },
    },
    categories: {},
    workflows: {},
  } as unknown as DigikalaMongooseRepositories;
}

describe('standalone-safe orchestration', () => {
  it('creates missing steps and reuses them on an idempotent replay', async () => {
    const standalone = createDigikalaStandaloneOrchestrator(fakeRepositories());
    const input = {
      product: productInput,
      variants: [variantInput],
      publications: [
        { panelKey: 'main', variantKey: variantInput.key, status: 'queued' },
      ],
    } as const;

    const created = await standalone.ensureCatalog(input);
    expect(created.product.created).toBe(true);
    expect(created.variants[0]?.created).toBe(true);
    expect(created.publications[0]?.created).toBe(true);
    expect(created.resumed).toBe(false);

    const resumed = await standalone.ensureCatalog(input);
    expect(resumed.product.created).toBe(false);
    expect(resumed.variants[0]?.created).toBe(false);
    expect(resumed.publications[0]?.created).toBe(false);
    expect(resumed.resumed).toBe(true);
  });

  it('rejects reused identities with different product data', async () => {
    const standalone = createDigikalaStandaloneOrchestrator(fakeRepositories());
    await standalone.ensureCatalog({ product: productInput });

    await expect(
      standalone.ensureCatalog({
        product: {
          ...productInput,
          title: { titleFa: 'عنوان متفاوت برای همان کلید' },
        },
      }),
    ).rejects.toBeInstanceOf(DigikalaIdentityConflictError);
  });

  it('validates variant references before writing a product', async () => {
    const repositories = fakeRepositories();
    const standalone = createDigikalaStandaloneOrchestrator(repositories);

    await expect(
      standalone.ensureCatalog({
        product: productInput,
        publications: [
          { panelKey: 'main', variantKey: 'UNKNOWN', status: 'queued' },
        ],
      }),
    ).rejects.toBeInstanceOf(DigikalaIdentityConflictError);
    await expect(repositories.products.findByKey('mug')).resolves.toBeNull();
  });

  it('rejects duplicate publication identities before writing', async () => {
    const repositories = fakeRepositories();
    const standalone = createDigikalaStandaloneOrchestrator(repositories);

    await expect(
      standalone.ensureCatalog({
        product: productInput,
        publications: [
          { panelKey: 'main', status: 'queued' },
          { panelKey: 'main', status: 'published' },
        ],
      }),
    ).rejects.toBeInstanceOf(DigikalaIdentityConflictError);
    await expect(repositories.products.findByKey('mug')).resolves.toBeNull();
  });

  it('never overwrites an existing publication during replay', async () => {
    const standalone = createDigikalaStandaloneOrchestrator(fakeRepositories());
    await standalone.ensureCatalog({
      product: productInput,
      publications: [{ panelKey: 'main', status: 'published' }],
    });

    await expect(
      standalone.ensureCatalog({
        product: productInput,
        publications: [{ panelKey: 'main', status: 'queued' }],
      }),
    ).rejects.toBeInstanceOf(DigikalaIdentityConflictError);
  });

  it('validates bulk concurrency', async () => {
    const standalone = createDigikalaStandaloneOrchestrator(fakeRepositories());
    await expect(
      standalone.ensureCatalogs([], { concurrency: 0 }),
    ).rejects.toThrow('between 1 and 32');
  });

  it('emits non-blocking lifecycle events', async () => {
    const phases: string[] = [];
    const standalone = createDigikalaStandaloneOrchestrator(
      fakeRepositories(),
      {
        observer: {
          onEvent(event) {
            phases.push(event.phase);
            if (event.phase === 'started')
              throw new Error('logger unavailable');
          },
        },
      },
    );

    await expect(
      standalone.ensureCatalog({ product: productInput }),
    ).resolves.toBeDefined();
    expect(phases).toEqual(['started', 'succeeded']);
  });

  it('inspects missing, matching, and conflicting catalog state', async () => {
    const standalone = createDigikalaStandaloneOrchestrator(fakeRepositories());
    const input = { product: productInput, variants: [variantInput] };

    await expect(standalone.inspectCatalog(input)).resolves.toMatchObject({
      consistent: false,
      repairable: true,
      items: [
        { entity: 'product', status: 'missing' },
        { entity: 'variant', status: 'missing' },
      ],
    });
    await standalone.ensureCatalog(input);
    await expect(standalone.inspectCatalog(input)).resolves.toMatchObject({
      consistent: true,
      repairable: true,
    });
    await expect(
      standalone.inspectCatalog({
        ...input,
        product: {
          ...productInput,
          title: { titleFa: 'عنوان متضاد' },
        },
      }),
    ).resolves.toMatchObject({
      consistent: false,
      repairable: false,
      items: expect.arrayContaining([
        expect.objectContaining({
          entity: 'product',
          status: 'conflict',
          key: 'mug',
        }),
      ]),
    });
  });
});
