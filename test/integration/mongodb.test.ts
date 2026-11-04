import mongoose, { Mongoose, type Connection } from 'mongoose';
import { createCreationWorkflow } from 'digikala/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DigikalaStandaloneOperationError,
  DigikalaDocumentNotFoundError,
  DigikalaDuplicateIdentityError,
  createDigikalaMongoose,
  type DigikalaMongoose,
  type StandaloneCatalogInput,
} from '../../src/index.js';

const mongoUri = process.env.MONGODB_URI;
const integration = mongoUri ? describe : describe.skip;
const databaseName = `digikala_mongoose_integration_${process.pid}_${Date.now()}`;

const catalogInput = {
  product: {
    key: 'integration-mug',
    status: 'ready',
    details: {
      categoryId: 10707,
      brandId: 1,
      isIranian: false,
      model: 'Integration Mug',
      packageLength: 12,
      packageWidth: 8,
      packageHeight: 10,
      packageWeight: 330,
    },
    title: { titleFa: 'ماگ تست یکپارچه' },
    images: [],
  },
  variants: [
    {
      key: 'INTEGRATION-MUG-WHITE',
      status: 'ready',
      input: {
        isActive: false,
        marketplaceSellerStock: 0,
        orderLimit: 2,
        warrantyId: 272,
        colorId: 2,
        site: 'digikala',
        shippingType: 'digikala',
      },
    },
  ],
  publications: [
    {
      panelKey: 'integration-panel',
      variantKey: 'INTEGRATION-MUG-WHITE',
      status: 'queued',
      supplierCode: 'INTEGRATION-MUG-WHITE',
    },
  ],
} satisfies StandaloneCatalogInput;

integration('standalone MongoDB integration', () => {
  let driver: Mongoose;
  let connection: Connection;
  let db: DigikalaMongoose;

  beforeAll(async () => {
    driver = new Mongoose();
    connection = await driver
      .createConnection(mongoUri!, {
        dbName: databaseName,
        serverSelectionTimeoutMS: 10_000,
      })
      .asPromise();
    db = createDigikalaMongoose({
      connection,
      modelPrefix: 'Integration',
      collectionPrefix: 'integration_',
    });
    await db.ensureIndexes();
  });

  afterAll(async () => {
    if (!driver) return;
    if (connection.readyState === 1) await connection.dropDatabase();
    await connection.close();
  });

  it('converges concurrent first writes to one catalog', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        db.standalone.ensureCatalog(catalogInput),
      ),
    );

    expect(results.filter((result) => result.product.created)).toHaveLength(1);
    expect(await db.models.ProductDraft.countDocuments()).toBe(1);
    expect(await db.models.VariantDraft.countDocuments()).toBe(1);
    expect(await db.models.Publication.countDocuments()).toBe(1);
  });

  it('reports partial progress and resumes after an interrupted step', async () => {
    const input: StandaloneCatalogInput = {
      product: { ...catalogInput.product, key: 'interrupted-product' },
      variants: [
        {
          ...catalogInput.variants![0]!,
          key: 'INTERRUPTED-VARIANT',
        },
      ],
      publications: [
        {
          panelKey: 'interrupted-panel',
          variantKey: 'INTERRUPTED-VARIANT',
          status: 'queued',
        },
      ],
    };
    const original = db.repositories.publications.upsert.bind(
      db.repositories.publications,
    );
    db.repositories.publications.upsert = async () => {
      throw new Error('simulated process interruption');
    };

    try {
      await db.standalone.ensureCatalog(input);
      throw new Error('Expected interrupted orchestration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DigikalaStandaloneOperationError);
      const operationError = error as DigikalaStandaloneOperationError;
      expect(operationError.step).toContain('publication:');
      expect(operationError.progress.completedVariantKeys).toEqual([
        'INTERRUPTED-VARIANT',
      ]);
    } finally {
      db.repositories.publications.upsert = original;
    }

    const resumed = await db.standalone.ensureCatalog(input);
    expect(resumed.resumed).toBe(true);
    expect(resumed.product.created).toBe(false);
    expect(resumed.variants[0]?.created).toBe(false);
    expect(resumed.publications[0]?.created).toBe(true);
  });

  it('preserves status when a direct partial upsert omits it', async () => {
    const product = await db.repositories.products.requireById(
      (await db.repositories.products.findByKey('integration-mug'))!.id,
    );
    const published = await db.repositories.publications.upsert({
      panelKey: 'status-panel',
      productId: product.id,
      status: 'published',
      remoteProductId: 12345,
    });
    const updated = await db.repositories.publications.upsert({
      panelKey: 'status-panel',
      productId: product.id,
      payloadHash: 'new-hash',
    });

    expect(published.status).toBe('published');
    expect(published.statusHistory).toHaveLength(1);
    expect(published.statusHistory[0]?.status).toBe('published');
    expect(updated.status).toBe('published');
    expect(updated.payloadHash).toBe('new-hash');
    expect(updated.statusHistory).toHaveLength(1);
  });

  it('does not resolve a variant mapping through the wrong product', async () => {
    const mapping = await db.models.Publication.findOne({
      panelKey: 'integration-panel',
    }).orFail();
    const wrongProductId = new mongoose.Types.ObjectId();

    await expect(
      db.repositories.publications.findForVariant(
        'integration-panel',
        wrongProductId,
        mapping.variantId!,
      ),
    ).resolves.toBeNull();
  });

  it('migrates legacy documents idempotently', async () => {
    const legacyId = new mongoose.Types.ObjectId();
    const legacyPublicationId = new mongoose.Types.ObjectId();
    await db.models.ProductDraft.collection.insertOne({
      _id: legacyId,
      key: 'legacy-product',
      status: 'draft',
      details: catalogInput.product.details,
      images: [],
      validation: { valid: false, issues: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.models.Publication.collection.insertOne({
      _id: legacyPublicationId,
      schemaVersion: 1,
      panelKey: 'legacy-panel',
      productId: legacyId,
      status: 'not_published',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const first = await db.migrate();
    const second = await db.migrate();
    const migrated = await db.models.ProductDraft.collection.findOne({
      _id: legacyId,
    });
    const migratedPublication = await db.models.Publication.collection.findOne({
      _id: legacyPublicationId,
    });

    expect(first.migratedDocuments).toBe(2);
    expect(first.schemaVersion).toBe(1);
    expect(second.migratedDocuments).toBe(0);
    expect(migrated?.schemaVersion).toBe(1);
    expect(migratedPublication?.statusHistory).toEqual([]);
    await db.models.ProductDraft.collection.deleteOne({ _id: legacyId });
    await db.models.Publication.collection.deleteOne({
      _id: legacyPublicationId,
    });
  });

  it('supports bounded bulk writes, cursor pagination, and archiving', async () => {
    const bulk = await db.standalone.ensureCatalogs(
      [1, 2, 3].map((number) => ({
        product: {
          ...catalogInput.product,
          key: `bulk-product-${number}`,
          details: {
            ...catalogInput.product.details,
            model: `Bulk ${number}`,
          },
        },
      })),
      { concurrency: 2 },
    );
    expect(bulk).toMatchObject({ succeeded: 3, failed: 0 });

    const first = await db.repositories.products.list({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    const second = await db.repositories.products.list({
      limit: 2,
      after: first.nextCursor,
    });
    expect(second.items.length).toBeGreaterThan(0);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);

    const archived = await db.repositories.products.archive(
      bulk.items[0]!.ok ? bulk.items[0]!.value.product.document.id : '',
    );
    expect(archived.status).toBe('archived');

    const publication = await db.models.Publication.findOne({
      panelKey: 'status-panel',
    }).orFail();
    const archivedPublication = await db.repositories.publications.archive(
      publication.id,
    );
    expect(archivedPublication.statusHistory.at(-1)?.status).toBe('archived');
  });

  it('covers repository lifecycle and typed failures', async () => {
    const product = await db.repositories.products.findByKey('integration-mug');
    const variant = await db.repositories.variants.findByKey(
      'INTEGRATION-MUG-WHITE',
    );
    expect(product).not.toBeNull();
    expect(variant).not.toBeNull();

    await db.repositories.categories.upsert({
      categoryId: 10707,
      version: 'integration-rules',
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      fields: [],
      attributeRules: [],
    });
    expect(await db.repositories.categories.isFresh(10707)).toBe(true);
    expect(await db.repositories.categories.isFresh(999999)).toBe(false);
    expect(
      (await db.repositories.products.validateForPublication(product!.id))
        .valid,
    ).toBe(true);

    const replaced = await db.repositories.products.replace(product!.id, {
      ...catalogInput.product,
      metadata: { replaced: true },
    });
    expect(replaced.metadata).toEqual({ replaced: true });
    expect(
      await db.repositories.products.buildPublicationPayloads(product!.id, 456),
    ).toMatchObject({ details: { draftProductId: 456 } });
    expect(
      await db.repositories.variants.buildPublicationPayload(variant!.id, 789),
    ).toMatchObject({ productId: 789 });

    const variantPage = await db.repositories.variants.list({
      productId: product!.id,
      limit: 1,
    });
    const publicationPage = await db.repositories.publications.list({
      panelKey: 'integration-panel',
      limit: 1,
    });
    expect(variantPage.items).toHaveLength(1);
    expect(publicationPage.items).toHaveLength(1);

    const workflow = createCreationWorkflow({
      vendorId: 'integration-panel',
      mode: 'new_product',
    });
    await db.repositories.workflows.save(
      'integration-panel',
      product!.id,
      workflow,
    );
    expect(
      await db.repositories.workflows.find('integration-panel', product!.id),
    ).toMatchObject({ state: { vendorId: 'integration-panel' } });

    await expect(
      db.repositories.products.create(catalogInput.product),
    ).rejects.toBeInstanceOf(DigikalaDuplicateIdentityError);
    await expect(
      db.repositories.products.requireById(new mongoose.Types.ObjectId()),
    ).rejects.toBeInstanceOf(DigikalaDocumentNotFoundError);
    await expect(db.repositories.products.list({ limit: 0 })).rejects.toThrow(
      'between 1 and 200',
    );
    await expect(
      db.repositories.products.list({ after: 'invalid' }),
    ).rejects.toThrow('MongoDB ObjectId');

    expect((await db.repositories.variants.archive(variant!.id)).status).toBe(
      'archived',
    );
    expect(
      (await db.repositories.publications.archive(publicationPage.items[0]!.id))
        .status,
    ).toBe('archived');
    expect((await db.ensureReady()).schemaVersion).toBe(1);
  });

  it('sustains a bounded 100-product standalone workload', async () => {
    const started = performance.now();
    const bulk = await db.standalone.ensureCatalogs(
      Array.from({ length: 100 }, (_, index) => ({
        product: {
          ...catalogInput.product,
          key: `load-product-${index}`,
          details: {
            ...catalogInput.product.details,
            model: `Load ${index}`,
          },
        },
      })),
      { concurrency: 8 },
    );
    const durationMs = performance.now() - started;

    expect(bulk).toMatchObject({ succeeded: 100, failed: 0 });
    expect(
      await db.models.ProductDraft.countDocuments({
        key: /^load-product-/,
      }),
    ).toBe(100);
    expect(durationMs).toBeLessThan(30_000);
  });
});
