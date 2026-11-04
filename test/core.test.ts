import { Mongoose } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
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
});
