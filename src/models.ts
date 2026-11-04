import {
  CreationWorkflowStateSchema,
  ProductAttributesInputSchema,
  ProductDetailsInputSchema,
  ProductSaveInputSchema,
  ProductTitleInputSchema,
  VariantCreateInputSchema,
} from 'digikala/schemas';
import { Schema, type Connection, type Model } from 'mongoose';
import {
  CategoryRuleInputSchema,
  ProductImageSchema,
  ProductDraftStatusSchema,
  PublicationStatusSchema,
  VariantDraftStatusSchema,
} from './contracts.js';
import type {
  CategoryRuleRecord,
  CreationWorkflowRecord,
  DigikalaMongooseModels,
  DigikalaMongooseOptions,
  ProductDraftRecord,
  PublicationRecord,
  VariantDraftRecord,
} from './types.js';
import { DigikalaConfigurationError } from './errors.js';

export const CURRENT_DIGIKALA_SCHEMA_VERSION = 1;

function zodValidator(schema: {
  safeParse(value: unknown): { success: boolean };
}) {
  return {
    validator: (value: unknown) => schema.safeParse(value).success,
    message: 'Value does not satisfy the Digikala validation contract',
  };
}

function existingOrCreate<T>(
  connection: Connection,
  name: string,
  schema: Schema,
): Model<T> {
  const existing = connection.models[name] as Model<T> | undefined;
  if (existing) {
    const expectedCollection = schema.options.collection;
    if (
      expectedCollection &&
      existing.collection.collectionName !== expectedCollection
    ) {
      throw new DigikalaConfigurationError(
        `model ${name} is already registered for ${existing.collection.collectionName}, not ${expectedCollection}`,
      );
    }
    return existing;
  }
  return connection.model(name, schema) as Model<T>;
}

export function createDigikalaModels(
  options: DigikalaMongooseOptions,
): DigikalaMongooseModels {
  const {
    connection,
    modelPrefix = 'Digikala',
    collectionPrefix = 'digikala_',
    autoCreateIndexes = true,
  } = options;
  if (!modelPrefix.trim()) {
    throw new DigikalaConfigurationError('modelPrefix must not be empty');
  }
  if (!collectionPrefix.trim()) {
    throw new DigikalaConfigurationError('collectionPrefix must not be empty');
  }
  const shared = {
    timestamps: true,
    strict: true as const,
    optimisticConcurrency: true,
    autoIndex: autoCreateIndexes,
  };

  const productSchema = new Schema<ProductDraftRecord>(
    {
      schemaVersion: {
        type: Number,
        required: true,
        default: CURRENT_DIGIKALA_SCHEMA_VERSION,
      },
      key: { type: String, required: true, trim: true },
      status: {
        type: String,
        required: true,
        default: 'draft',
        enum: ProductDraftStatusSchema.options,
      },
      details: {
        type: Schema.Types.Mixed,
        required: true,
        validate: zodValidator(
          ProductDetailsInputSchema.omit({ draftProductId: true }),
        ),
      },
      title: {
        type: Schema.Types.Mixed,
        validate: zodValidator(
          ProductTitleInputSchema.omit({ draftProductId: true }),
        ),
      },
      attributes: {
        type: Schema.Types.Mixed,
        validate: zodValidator(
          ProductAttributesInputSchema.omit({ draftProductId: true }),
        ),
      },
      saveOptions: {
        type: Schema.Types.Mixed,
        validate: zodValidator(
          ProductSaveInputSchema.omit({
            categoryId: true,
            draftProductId: true,
          }),
        ),
      },
      images: {
        type: [Schema.Types.Mixed],
        default: [],
        validate: zodValidator(ProductImageSchema.array()),
      } as any,
      metadata: { type: Schema.Types.Mixed },
      validation: {
        valid: { type: Boolean, required: true, default: false },
        issues: { type: [Schema.Types.Mixed], default: [] },
        ruleVersion: String,
        validatedAt: Date,
      },
    },
    { ...shared, collection: `${collectionPrefix}products` },
  );
  productSchema.index({ key: 1 }, { unique: true });
  productSchema.index({ 'details.categoryId': 1, status: 1 });

  const variantSchema = new Schema<VariantDraftRecord>(
    {
      schemaVersion: {
        type: Number,
        required: true,
        default: CURRENT_DIGIKALA_SCHEMA_VERSION,
      },
      key: { type: String, required: true, trim: true },
      productId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: `${modelPrefix}ProductDraft`,
      },
      status: {
        type: String,
        required: true,
        default: 'draft',
        enum: VariantDraftStatusSchema.options,
      },
      input: {
        type: Schema.Types.Mixed,
        required: true,
        validate: zodValidator(
          VariantCreateInputSchema.omit({ productId: true }),
        ),
      },
      metadata: { type: Schema.Types.Mixed },
    },
    { ...shared, collection: `${collectionPrefix}variants` },
  );
  variantSchema.index({ key: 1 }, { unique: true });
  variantSchema.index({ productId: 1, status: 1 });

  const categoryRuleSchema = new Schema<CategoryRuleRecord>(
    {
      schemaVersion: {
        type: Number,
        required: true,
        default: CURRENT_DIGIKALA_SCHEMA_VERSION,
      },
      categoryId: { type: Number, required: true },
      version: { type: String, required: true },
      title: String,
      fields: { type: [Schema.Types.Mixed], default: [] } as any,
      attributeRules: { type: [Schema.Types.Mixed], default: [] } as any,
      sourcePayload: { type: Schema.Types.Mixed },
      fetchedAt: { type: Date, required: true },
      expiresAt: Date,
    },
    { ...shared, collection: `${collectionPrefix}category_rules` },
  );
  categoryRuleSchema
    .path('fields')
    .validate(
      (value: unknown) =>
        CategoryRuleInputSchema.shape.fields.safeParse(value).success,
      'Category fields do not satisfy the normalized rule contract',
    );
  categoryRuleSchema
    .path('attributeRules')
    .validate(
      (value: unknown) =>
        CategoryRuleInputSchema.shape.attributeRules.safeParse(value).success,
      'Category attributes do not satisfy the normalized rule contract',
    );
  categoryRuleSchema.index({ categoryId: 1 }, { unique: true });
  categoryRuleSchema.index({ expiresAt: 1 });

  const publicationSchema = new Schema<PublicationRecord>(
    {
      schemaVersion: {
        type: Number,
        required: true,
        default: CURRENT_DIGIKALA_SCHEMA_VERSION,
      },
      panelKey: { type: String, required: true, trim: true },
      productId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: `${modelPrefix}ProductDraft`,
      },
      variantId: {
        type: Schema.Types.ObjectId,
        ref: `${modelPrefix}VariantDraft`,
      },
      status: {
        type: String,
        required: true,
        default: 'not_published',
        enum: PublicationStatusSchema.options,
      },
      statusHistory: {
        type: [
          new Schema(
            {
              status: {
                type: String,
                required: true,
                enum: PublicationStatusSchema.options,
              },
              at: { type: Date, required: true },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      remoteProductId: Number,
      remoteDraftProductId: Number,
      remoteVariantId: Number,
      supplierCode: String,
      payload: { type: Schema.Types.Mixed },
      payloadHash: String,
      lastError: String,
      synchronizedAt: Date,
      metadata: { type: Schema.Types.Mixed },
    },
    { ...shared, collection: `${collectionPrefix}publications` },
  );
  publicationSchema.index(
    { panelKey: 1, productId: 1, variantId: 1 },
    { unique: true },
  );
  publicationSchema.index(
    { panelKey: 1, remoteProductId: 1 },
    {
      unique: true,
      partialFilterExpression: { remoteProductId: { $type: 'number' } },
    },
  );
  publicationSchema.index(
    { panelKey: 1, remoteVariantId: 1 },
    {
      unique: true,
      partialFilterExpression: { remoteVariantId: { $type: 'number' } },
    },
  );
  publicationSchema.index({ status: 1, updatedAt: 1 });

  const workflowSchema = new Schema<CreationWorkflowRecord>(
    {
      schemaVersion: {
        type: Number,
        required: true,
        default: CURRENT_DIGIKALA_SCHEMA_VERSION,
      },
      panelKey: { type: String, required: true, trim: true },
      productId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: `${modelPrefix}ProductDraft`,
      },
      state: {
        type: Schema.Types.Mixed,
        required: true,
        validate: zodValidator(CreationWorkflowStateSchema),
      },
    },
    { ...shared, collection: `${collectionPrefix}creation_workflows` },
  );
  workflowSchema.index({ panelKey: 1, productId: 1 }, { unique: true });
  workflowSchema.index({ 'state.status': 1, updatedAt: 1 });

  return {
    ProductDraft: existingOrCreate(
      connection,
      `${modelPrefix}ProductDraft`,
      productSchema,
    ),
    VariantDraft: existingOrCreate(
      connection,
      `${modelPrefix}VariantDraft`,
      variantSchema,
    ),
    CategoryRule: existingOrCreate(
      connection,
      `${modelPrefix}CategoryRule`,
      categoryRuleSchema,
    ),
    Publication: existingOrCreate(
      connection,
      `${modelPrefix}Publication`,
      publicationSchema,
    ),
    CreationWorkflow: existingOrCreate(
      connection,
      `${modelPrefix}CreationWorkflow`,
      workflowSchema,
    ),
  };
}

export async function ensureDigikalaIndexes(
  models: DigikalaMongooseModels,
): Promise<void> {
  await Promise.all(
    Object.values(models).map((model) => model.createIndexes()),
  );
}

export async function migrateDigikalaData(
  models: DigikalaMongooseModels,
): Promise<{ migratedDocuments: number; schemaVersion: number }> {
  const results = await Promise.all(
    Object.values(models).map((model) =>
      model
        .updateMany(
          { schemaVersion: { $exists: false } },
          { $set: { schemaVersion: CURRENT_DIGIKALA_SCHEMA_VERSION } },
          { runValidators: false },
        )
        .exec(),
    ),
  );
  return {
    migratedDocuments: results.reduce(
      (total, result) => total + result.modifiedCount,
      0,
    ),
    schemaVersion: CURRENT_DIGIKALA_SCHEMA_VERSION,
  };
}
