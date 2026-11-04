import {
  ProductAttributesInputSchema,
  ProductDetailsInputSchema,
  ProductSaveInputSchema,
  ProductTitleInputSchema,
  VariantCreateInputSchema,
} from 'digikala/schemas';
import { z } from 'zod';

const key = z.string().trim().min(1).max(160);
const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a MongoDB ObjectId');
const jsonValue = z.unknown();

export const ProductDraftStatusSchema = z.enum([
  'draft',
  'incomplete',
  'ready',
  'publishing',
  'pending_moderation',
  'approved',
  'rejected',
  'archived',
]);

export const ProductImageSchema = z
  .object({
    imageId: z.string().trim().min(1),
    url: z.url().optional(),
    isMain: z.boolean().default(false),
    sortOrder: z.number().int().nonnegative().default(0),
    alt: z.string().trim().max(250).optional(),
    metadata: z.record(z.string(), jsonValue).optional(),
  })
  .strict();

export const ProductDraftInputSchema = z
  .object({
    key,
    status: ProductDraftStatusSchema.default('draft'),
    details: ProductDetailsInputSchema.omit({ draftProductId: true }),
    title: ProductTitleInputSchema.omit({ draftProductId: true }).optional(),
    attributes: ProductAttributesInputSchema.omit({
      draftProductId: true,
    }).optional(),
    saveOptions: ProductSaveInputSchema.omit({
      categoryId: true,
      draftProductId: true,
    }).optional(),
    images: z.array(ProductImageSchema).default([]),
    metadata: z.record(z.string(), jsonValue).optional(),
  })
  .strict();

export const VariantDraftStatusSchema = z.enum([
  'draft',
  'ready',
  'publishing',
  'published',
  'rejected',
  'archived',
]);

export const VariantDraftInputSchema = z
  .object({
    key,
    productId: objectId,
    status: VariantDraftStatusSchema.default('draft'),
    input: VariantCreateInputSchema.omit({ productId: true }),
    metadata: z.record(z.string(), jsonValue).optional(),
  })
  .strict();

export const CategoryFieldRuleSchema = z
  .object({
    path: z.string().trim().min(1),
    label: z.string().trim().min(1),
    type: z.enum([
      'string',
      'number',
      'boolean',
      'select',
      'multiselect',
      'image',
      'object',
    ]),
    required: z.boolean().default(false),
    values: z
      .array(
        z
          .object({
            value: z.union([z.string(), z.number(), z.boolean()]),
            label: z.string().trim().min(1),
          })
          .strict(),
      )
      .optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    digikalaAttributeId: z.number().int().positive().optional(),
    sortOrder: z.number().int().default(0),
    metadata: z.record(z.string(), jsonValue).optional(),
  })
  .strict();

export const CategoryAttributeRuleSchema = z
  .object({
    id: z.number().int().positive(),
    label: z.string().trim().min(1),
    type: CategoryFieldRuleSchema.shape.type,
    sourceType: z.string().trim().min(1).optional(),
    required: z.boolean().default(false),
    groupId: z.number().int().positive().optional(),
    groupTitle: z.string().optional(),
    unit: z.string().optional(),
    postfix: z.string().optional(),
    hint: z.string().optional(),
    defaultValue: jsonValue.optional(),
    values: CategoryFieldRuleSchema.shape.values,
    metadata: z.record(z.string(), jsonValue).optional(),
  })
  .strict();

export const CategoryRuleInputSchema = z
  .object({
    categoryId: z.number().int().positive(),
    version: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    fields: z.array(CategoryFieldRuleSchema).default([]),
    attributeRules: z.array(CategoryAttributeRuleSchema).default([]),
    sourcePayload: jsonValue.optional(),
    fetchedAt: z.coerce.date(),
    expiresAt: z.coerce.date().optional(),
  })
  .strict();

export const PublicationStatusSchema = z.enum([
  'not_published',
  'queued',
  'publishing',
  'pending_moderation',
  'published',
  'rejected',
  'failed',
  'archived',
]);

export const PublicationInputSchema = z
  .object({
    panelKey: key,
    productId: objectId,
    variantId: objectId.optional(),
    status: PublicationStatusSchema.default('not_published'),
    remoteProductId: z.number().int().positive().optional(),
    remoteDraftProductId: z.number().int().positive().optional(),
    remoteVariantId: z.number().int().positive().optional(),
    supplierCode: z.string().trim().min(1).optional(),
    payload: jsonValue.optional(),
    payloadHash: z.string().optional(),
    lastError: z.string().optional(),
    synchronizedAt: z.coerce.date().optional(),
    metadata: z.record(z.string(), jsonValue).optional(),
  })
  .strict();

export const PublicationUpdateSchema = z
  .object({
    status: PublicationStatusSchema.optional(),
    remoteProductId: z.number().int().positive().nullable().optional(),
    remoteDraftProductId: z.number().int().positive().nullable().optional(),
    remoteVariantId: z.number().int().positive().nullable().optional(),
    supplierCode: z.string().trim().min(1).nullable().optional(),
    payload: jsonValue.optional(),
    payloadHash: z.string().nullable().optional(),
    lastError: z.string().nullable().optional(),
    synchronizedAt: z.coerce.date().nullable().optional(),
    metadata: z.record(z.string(), jsonValue).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one publication field must be updated',
  });

export type ProductDraftInput = z.input<typeof ProductDraftInputSchema>;
export type ProductDraftData = z.output<typeof ProductDraftInputSchema>;
export type ProductDraftStatus = z.output<typeof ProductDraftStatusSchema>;
export type ProductImage = z.output<typeof ProductImageSchema>;
export type VariantDraftInput = z.input<typeof VariantDraftInputSchema>;
export type VariantDraftData = z.output<typeof VariantDraftInputSchema>;
export type VariantDraftStatus = z.output<typeof VariantDraftStatusSchema>;
export type CategoryFieldRule = z.output<typeof CategoryFieldRuleSchema>;
export type CategoryAttributeRule = z.output<
  typeof CategoryAttributeRuleSchema
>;
export type CategoryRuleInput = z.input<typeof CategoryRuleInputSchema>;
export type CategoryRuleData = z.output<typeof CategoryRuleInputSchema>;
export type PublicationInput = z.input<typeof PublicationInputSchema>;
export type PublicationData = z.output<typeof PublicationInputSchema>;
export type PublicationStatus = z.output<typeof PublicationStatusSchema>;
export type PublicationUpdate = z.input<typeof PublicationUpdateSchema>;
