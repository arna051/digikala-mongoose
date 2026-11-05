import { Mongoose } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  DigikalaCategoryNormalizationError,
  DigikalaConfigurationError,
  ProductDraftInputSchema,
  VariantDraftInputSchema,
  buildProductPublicationPayloads,
  buildVariantPublicationPayload,
  createDigikalaModels,
  normalizeDigikalaCategoryAttributes,
  validateProductDraft,
} from '../src/index.js';

const product = {
  key: 'mug-good-vibes',
  details: {
    categoryId: 10707,
    brandId: 1,
    isIranian: false,
    model: 'Good Vibes',
    packageLength: 12,
    packageWidth: 8,
    packageHeight: 10,
    packageWeight: 330,
  },
  title: {
    titleFa: 'ماگ سرامیکی مدل Good Vibes',
    description: 'یک ماگ سرامیکی',
  },
  images: [{ imageId: 'image-1', isMain: true }],
} as const;

describe('Digikala-compatible contracts', () => {
  it('validates a product once and builds SDK payloads with remote draft ids', () => {
    const parsed = ProductDraftInputSchema.parse(product);
    const payloads = buildProductPublicationPayloads(parsed, 123);

    expect(payloads.details).toMatchObject({
      categoryId: 10707,
      draftProductId: 123,
    });
    expect(payloads.title).toMatchObject({ draftProductId: 123 });
    expect(payloads.save).toEqual({ categoryId: 10707, draftProductId: 123 });
  });

  it('applies normalized category rules for UI-ready validation', () => {
    const invalid = {
      ...ProductDraftInputSchema.parse(product),
      title: undefined,
    };
    const result = validateProductDraft(invalid, {
      categoryId: 10707,
      version: 'rules-1',
      fields: [
        {
          path: 'title.titleFa',
          label: 'Persian title',
          type: 'string',
          required: true,
          sortOrder: 0,
        },
      ],
    });

    expect(result).toMatchObject({
      valid: false,
      ruleVersion: 'rules-1',
      issues: [{ path: 'title.titleFa', code: 'required' }],
    });
  });

  it('normalizes Digikala attribute metadata and validates attribute ids', () => {
    const rules = normalizeDigikalaCategoryAttributes({
      categoryId: 10707,
      version: 'live-1',
      fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
      response: {
        status: 'ok',
        data: {
          category_group_attributes: {
            1904: {
              group_title: 'مشخصات',
              attributes: {
                1597: {
                  id: 1597,
                  title: 'زبان',
                  type: 'select',
                  required: true,
                  values: { 7070: { text: 'فارسی' } },
                },
              },
            },
          },
          weight_attribute: true,
          weight_attribute_required: true,
        },
      },
    });

    expect(rules.attributeRules[0]).toMatchObject({
      id: 1597,
      type: 'select',
      required: true,
      values: [{ value: 7070, label: 'فارسی' }],
    });
    expect(rules.fields).toContainEqual(
      expect.objectContaining({
        path: 'attributes.weight',
        required: true,
      }),
    );

    const result = validateProductDraft(
      {
        ...ProductDraftInputSchema.parse(product),
        attributes: {
          weight: 330,
          attributes: [[{ id: 1597, value: 7070 }]],
        },
      },
      rules,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects malformed category responses and deduplicates attributes', () => {
    expect(() =>
      normalizeDigikalaCategoryAttributes({
        categoryId: 10707,
        response: { status: 'error', data: null },
      }),
    ).toThrow(DigikalaCategoryNormalizationError);

    const rules = normalizeDigikalaCategoryAttributes({
      categoryId: 10707,
      response: {
        status: 'ok',
        data: {
          category_group_attributes: {
            1: {
              attributes: { 10: { id: 10, title: 'رنگ', type: 'select' } },
            },
            2: {
              attributes: { 10: { id: 10, title: 'رنگ', type: 'select' } },
            },
          },
        },
      },
    });

    expect(rules.attributeRules).toHaveLength(1);
    expect(rules.version).toBe(
      `${rules.categoryId}:${rules.fetchedAt.toISOString()}`,
    );
  });

  it('returns useful schema issue codes and rejects expired rules', () => {
    const parsedProduct = ProductDraftInputSchema.parse(product);
    const malformed = validateProductDraft({
      ...parsedProduct,
      key: '',
    });
    expect(malformed.issues[0]?.code).toBe('too_small');

    const expired = validateProductDraft(parsedProduct, {
      categoryId: 10707,
      version: 'expired-v1',
      fields: [],
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    expect(expired).toMatchObject({
      valid: false,
      issues: [{ path: 'details.categoryId', code: 'invalid_value' }],
    });
  });

  it('reports field and attribute rule violations precisely', () => {
    const parsed = ProductDraftInputSchema.parse({
      ...product,
      metadata: { code: 'bad', choice: 'x', tags: ['x'] },
      attributes: {
        attributes: [[{ id: 100, value: 9 }]],
      },
    });
    const result = validateProductDraft(parsed, {
      categoryId: 10707,
      version: 'strict-rules',
      fields: [
        {
          path: 'details.packageWeight',
          label: 'weight',
          type: 'number',
          required: true,
          min: 500,
          max: 600,
          sortOrder: 0,
        },
        {
          path: 'metadata.code',
          label: 'code',
          type: 'string',
          required: true,
          pattern: '^GOOD$',
          sortOrder: 1,
        },
        {
          path: 'metadata.choice',
          label: 'choice',
          type: 'select',
          required: true,
          values: [{ value: 'allowed', label: 'Allowed' }],
          sortOrder: 2,
        },
        {
          path: 'metadata.tags',
          label: 'tags',
          type: 'multiselect',
          required: true,
          values: [{ value: 'allowed', label: 'Allowed' }],
          sortOrder: 3,
        },
        {
          path: 'metadata.missing',
          label: 'missing',
          type: 'boolean',
          required: true,
          sortOrder: 4,
        },
      ],
      attributeRules: [
        {
          id: 100,
          label: 'attribute',
          type: 'select',
          required: true,
          values: [{ value: 10, label: 'Ten' }],
        },
        {
          id: 101,
          label: 'required attribute',
          type: 'string',
          required: true,
        },
      ],
    });

    expect(new Set(result.issues.map((issue) => issue.code))).toEqual(
      new Set(['too_small', 'invalid_format', 'invalid_value', 'required']),
    );
  });

  it('rejects unsafe remote validation patterns without executing them', () => {
    const started = performance.now();
    const result = validateProductDraft(
      {
        ...ProductDraftInputSchema.parse(product),
        metadata: { candidate: `${'a'.repeat(20_000)}!` },
      },
      {
        categoryId: 10707,
        version: 'unsafe-pattern',
        fields: [
          {
            path: 'metadata.candidate',
            label: 'candidate',
            type: 'string',
            required: true,
            pattern: '(a+)+$',
            sortOrder: 0,
          },
        ],
      },
    );

    expect(performance.now() - started).toBeLessThan(100);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_format' }),
    );
  });

  it('does not allow metadata to pollute object prototypes', () => {
    const metadata = JSON.parse('{"__proto__":{"polluted":true}}') as Record<
      string,
      unknown
    >;
    ProductDraftInputSchema.parse({ ...product, metadata });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('builds a validated variant request only after a remote product exists', () => {
    const parsed = VariantDraftInputSchema.parse({
      key: 'MUG-WHITE',
      productId: '507f1f77bcf86cd799439011',
      input: {
        isActive: false,
        orderLimit: 2,
        marketplaceSellerStock: 0,
        warrantyId: 272,
        site: 'digikala',
        shippingType: 'digikala',
      },
    });

    expect(buildVariantPublicationPayload(parsed, 18794338)).toMatchObject({
      productId: 18794338,
      marketplaceSellerStock: 0,
      orderLimit: 2,
    });
  });

  it('persists multi-theme requirements and enforces them before publication', () => {
    const parsed = VariantDraftInputSchema.parse({
      key: 'SHIRT-BLUE-L',
      productId: '507f1f77bcf86cd799439011',
      input: {
        isActive: false,
        orderLimit: 2,
        marketplaceSellerStock: 0,
        warrantyId: 272,
        site: 'digikala',
        shippingType: 'seller',
        leadTime: 5,
        themeValues: [
          { themeId: 7, themeValueId: 70 },
          { themeId: 8, themeValueId: 80 },
        ],
      },
      requirements: {
        lead_time_max: 3,
        themes: [{ id: 7 }, { id: 8 }],
      },
      requirementsFetchedAt: new Date('2026-11-05T00:00:00.000Z'),
    });

    expect(() => buildVariantPublicationPayload(parsed, 18794338)).toThrow();
    expect(parsed.requirements?.themes).toHaveLength(2);
  });
});

describe('Mongoose models', () => {
  it('is connection-scoped, idempotent, indexed, and validates SDK fields', async () => {
    const mongoose = new Mongoose();
    const connection = mongoose.createConnection();
    const first = createDigikalaModels({
      connection,
      autoCreateIndexes: false,
    });
    const second = createDigikalaModels({
      connection,
      autoCreateIndexes: false,
    });

    expect(second.ProductDraft).toBe(first.ProductDraft);
    const keyIndex = first.ProductDraft.schema
      .indexes()
      .find(([fields]) => fields.key === 1);
    expect(keyIndex?.[1]).toMatchObject({ unique: true });

    await expect(
      new first.ProductDraft({
        key: 'valid',
        details: product.details,
      }).validate(),
    ).resolves.toBeUndefined();

    await expect(
      new first.VariantDraft({
        key: 'invalid',
        productId: '507f1f77bcf86cd799439011',
        input: {
          isActive: false,
          orderLimit: 1,
          marketplaceSellerStock: 0,
          warrantyId: 272,
          site: 'digikala',
          shippingType: 'seller',
        },
      }).validate(),
    ).rejects.toThrow('Digikala validation contract');

    await connection.close();
  });

  it('rejects model-name reuse with a different collection prefix', async () => {
    const mongoose = new Mongoose();
    const connection = mongoose.createConnection();
    createDigikalaModels({
      connection,
      modelPrefix: 'Collision',
      collectionPrefix: 'first_',
      autoCreateIndexes: false,
    });

    expect(() =>
      createDigikalaModels({
        connection,
        modelPrefix: 'Collision',
        collectionPrefix: 'second_',
        autoCreateIndexes: false,
      }),
    ).toThrow(DigikalaConfigurationError);
    await connection.close();
  });
});
