import {
  CreationWorkflowStateSchema,
  type CreationWorkflowState,
} from 'digikala/schemas';
import { Types, type ClientSession } from 'mongoose';
import {
  CategoryRuleInputSchema,
  ProductDraftInputSchema,
  PublicationInputSchema,
  PublicationUpdateSchema,
  VariantDraftInputSchema,
  type CategoryRuleInput,
  type ProductDraftInput,
  type PublicationInput,
  type PublicationUpdate,
  type VariantDraftInput,
} from './contracts.js';
import {
  DigikalaConcurrencyError,
  DigikalaDocumentNotFoundError,
  DigikalaDuplicateIdentityError,
} from './errors.js';
import {
  buildProductPublicationPayloads,
  buildVariantPublicationPayload,
} from './payloads.js';
import type {
  CategoryRuleDocument,
  CreationWorkflowDocument,
  DigikalaMongooseModels,
  ProductDraftDocument,
  ProductPublicationPayloads,
  PublicationDocument,
  VariantDraftDocument,
  VariantPublicationPayload,
} from './types.js';
import {
  validateProductDraft,
  type CategoryValidationResult,
} from './validation.js';

type RepositoryFilter = Record<string, unknown>;

export interface MutationOptions {
  session?: ClientSession;
}

export type QueryOptions = MutationOptions;

export interface PageOptions extends QueryOptions {
  limit?: number;
  after?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface ProductListOptions extends PageOptions {
  status?: ProductDraftInput['status'];
  categoryId?: number;
}

export interface VariantListOptions extends PageOptions {
  productId?: string | Types.ObjectId;
  status?: VariantDraftInput['status'];
}

export interface PublicationListOptions extends PageOptions {
  panelKey?: string;
  productId?: string | Types.ObjectId;
  status?: PublicationInput['status'];
}

function pagination(options: PageOptions): {
  limit: number;
  after?: Types.ObjectId;
} {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new RangeError(
      'Pagination limit must be an integer between 1 and 200',
    );
  }
  if (options.after && !Types.ObjectId.isValid(options.after)) {
    throw new TypeError('Pagination cursor must be a MongoDB ObjectId');
  }
  return {
    limit,
    ...(options.after ? { after: new Types.ObjectId(options.after) } : {}),
  };
}

function page<T extends { _id: unknown }>(items: T[], limit: number): Page<T> {
  const hasMore = items.length > limit;
  const visible = hasMore ? items.slice(0, limit) : items;
  return {
    items: visible,
    ...(hasMore ? { nextCursor: String(visible.at(-1)!._id) } : {}),
  };
}

function objectIdFilter(
  value: string | Types.ObjectId | undefined,
  field: string,
): Types.ObjectId | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Types.ObjectId) return value;
  if (!Types.ObjectId.isValid(value)) {
    throw new TypeError(`${field} must be a MongoDB ObjectId`);
  }
  return new Types.ObjectId(value);
}

function isDuplicateKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: number;
    writeErrors?: Array<{ code?: number; err?: { code?: number } }>;
  };
  return (
    candidate.code === 11000 ||
    candidate.writeErrors?.some(
      (item) => item.code === 11000 || item.err?.code === 11000,
    ) === true
  );
}

function translateWriteError(
  error: unknown,
  entity: string,
  identifier: string,
): never {
  if (isDuplicateKey(error)) {
    throw new DigikalaDuplicateIdentityError(entity, identifier, {
      cause: error,
    });
  }
  if (error instanceof Error && error.name === 'VersionError') {
    throw new DigikalaConcurrencyError(entity, identifier, { cause: error });
  }
  throw error;
}

async function translatedWrite<T>(
  operation: () => Promise<T>,
  entity: string,
  identifier: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    translateWriteError(error, entity, identifier);
  }
}

export function productDraftInputFromDocument(
  document: ProductDraftDocument,
): ProductDraftInput {
  return {
    key: document.key,
    status: document.status,
    details: document.details,
    ...(document.title ? { title: document.title } : {}),
    ...(document.attributes ? { attributes: document.attributes } : {}),
    ...(document.saveOptions ? { saveOptions: document.saveOptions } : {}),
    images: document.images,
    ...(document.duplicateProductId
      ? { duplicateProductId: document.duplicateProductId }
      : {}),
    ...(document.metadata ? { metadata: document.metadata } : {}),
  };
}

export function variantDraftInputFromDocument(
  document: VariantDraftDocument,
): VariantDraftInput {
  return {
    key: document.key,
    productId: String(document.productId),
    status: document.status,
    input: document.input,
    ...(document.requirements ? { requirements: document.requirements } : {}),
    ...(document.requirementsFetchedAt
      ? { requirementsFetchedAt: document.requirementsFetchedAt }
      : {}),
    ...(document.metadata ? { metadata: document.metadata } : {}),
  };
}

export function publicationInputFromDocument(
  document: PublicationDocument,
): PublicationInput {
  return {
    panelKey: document.panelKey,
    productId: String(document.productId),
    ...(document.variantId ? { variantId: String(document.variantId) } : {}),
    status: document.status,
    ...(document.remoteProductId
      ? { remoteProductId: document.remoteProductId }
      : {}),
    ...(document.remoteDraftProductId
      ? { remoteDraftProductId: document.remoteDraftProductId }
      : {}),
    ...(document.remoteVariantId
      ? { remoteVariantId: document.remoteVariantId }
      : {}),
    ...(document.supplierCode ? { supplierCode: document.supplierCode } : {}),
    ...(document.payload === undefined ? {} : { payload: document.payload }),
    ...(document.payloadHash ? { payloadHash: document.payloadHash } : {}),
    ...(document.lastError ? { lastError: document.lastError } : {}),
    ...(document.synchronizedAt
      ? { synchronizedAt: document.synchronizedAt }
      : {}),
    ...(document.metadata ? { metadata: document.metadata } : {}),
  };
}

export class ProductDraftRepository {
  constructor(
    private readonly models: DigikalaMongooseModels,
    private readonly categories: CategoryRuleRepository,
  ) {}

  async create(
    input: ProductDraftInput,
    options: MutationOptions = {},
  ): Promise<ProductDraftDocument> {
    const data = ProductDraftInputSchema.parse(input);
    try {
      const [created] = await this.models.ProductDraft.create(
        [{ ...data, validation: { valid: false, issues: [] } }],
        options,
      );
      return created!;
    } catch (error) {
      translateWriteError(error, 'ProductDraft', data.key);
    }
  }

  findByKey(key: string): Promise<ProductDraftDocument | null> {
    return this.models.ProductDraft.findOne({ key }).exec();
  }

  async list(
    options: ProductListOptions = {},
  ): Promise<Page<ProductDraftDocument>> {
    const { limit, after } = pagination(options);
    const filter: RepositoryFilter = {
      ...(after ? { _id: { $gt: after } } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.categoryId
        ? { 'details.categoryId': options.categoryId }
        : {}),
    };
    const items = await this.models.ProductDraft.find(filter)
      .sort({ _id: 1 })
      .limit(limit + 1)
      .session(options.session ?? null)
      .exec();
    return page(items, limit);
  }

  async archive(
    id: string | Types.ObjectId,
    options: MutationOptions = {},
  ): Promise<ProductDraftDocument> {
    const document = await this.models.ProductDraft.findByIdAndUpdate(
      id,
      { $set: { status: 'archived' } },
      {
        returnDocument: 'after',
        runValidators: true,
        session: options.session,
      },
    ).exec();
    if (!document)
      throw new DigikalaDocumentNotFoundError('ProductDraft', String(id));
    return document;
  }

  findById(
    id: string | Types.ObjectId,
    options: QueryOptions = {},
  ): Promise<ProductDraftDocument | null> {
    return this.models.ProductDraft.findById(id)
      .session(options.session ?? null)
      .exec();
  }

  async requireById(
    id: string | Types.ObjectId,
    options: QueryOptions = {},
  ): Promise<ProductDraftDocument> {
    const product = await this.findById(id, options);
    if (!product)
      throw new DigikalaDocumentNotFoundError('ProductDraft', String(id));
    return product;
  }

  async replace(
    id: string | Types.ObjectId,
    input: ProductDraftInput,
    options: MutationOptions = {},
  ): Promise<ProductDraftDocument> {
    const product = await this.requireById(id, options);
    product.overwrite({
      ...ProductDraftInputSchema.parse(input),
      schemaVersion: product.schemaVersion,
      validation: { valid: false, issues: [] },
    });
    try {
      return await product.save(options);
    } catch (error) {
      translateWriteError(error, 'ProductDraft', String(id));
    }
  }

  async validateForPublication(
    id: string | Types.ObjectId,
    options: MutationOptions & { persist?: boolean } = {},
  ): Promise<CategoryValidationResult> {
    const product = await this.requireById(id, options);
    const plain = productDraftInputFromDocument(product);
    const category = await this.categories.findByCategoryId(
      product.details.categoryId,
      options,
    );
    const result = validateProductDraft(plain, category?.toObject());
    if (options.persist !== false) {
      product.validation = {
        valid: result.valid,
        issues: result.issues,
        ...(result.ruleVersion ? { ruleVersion: result.ruleVersion } : {}),
        validatedAt: new Date(),
      };
      try {
        await product.save({ session: options.session });
      } catch (error) {
        translateWriteError(error, 'ProductDraft', String(id));
      }
    }
    return result;
  }

  async buildPublicationPayloads(
    id: string | Types.ObjectId,
    remoteDraftProductId: number,
  ): Promise<ProductPublicationPayloads> {
    const product = await this.requireById(id);
    return buildProductPublicationPayloads(
      ProductDraftInputSchema.parse(productDraftInputFromDocument(product)),
      remoteDraftProductId,
    );
  }
}

export class VariantDraftRepository {
  constructor(private readonly models: DigikalaMongooseModels) {}

  async create(
    input: VariantDraftInput,
    options: MutationOptions = {},
  ): Promise<VariantDraftDocument> {
    const data = VariantDraftInputSchema.parse(input);
    try {
      const [created] = await this.models.VariantDraft.create([data], options);
      return created!;
    } catch (error) {
      translateWriteError(error, 'VariantDraft', data.key);
    }
  }

  findByKey(key: string): Promise<VariantDraftDocument | null> {
    return this.models.VariantDraft.findOne({ key }).exec();
  }

  async list(
    options: VariantListOptions = {},
  ): Promise<Page<VariantDraftDocument>> {
    const { limit, after } = pagination(options);
    const productId = objectIdFilter(options.productId, 'productId');
    const filter: RepositoryFilter = {
      ...(after ? { _id: { $gt: after } } : {}),
      ...(productId ? { productId } : {}),
      ...(options.status ? { status: options.status } : {}),
    };
    const items = await this.models.VariantDraft.find(filter)
      .sort({ _id: 1 })
      .limit(limit + 1)
      .session(options.session ?? null)
      .exec();
    return page(items, limit);
  }

  async archive(
    id: string | Types.ObjectId,
    options: MutationOptions = {},
  ): Promise<VariantDraftDocument> {
    const document = await this.models.VariantDraft.findByIdAndUpdate(
      id,
      { $set: { status: 'archived' } },
      {
        returnDocument: 'after',
        runValidators: true,
        session: options.session,
      },
    ).exec();
    if (!document)
      throw new DigikalaDocumentNotFoundError('VariantDraft', String(id));
    return document;
  }

  findById(
    id: string | Types.ObjectId,
    options: QueryOptions = {},
  ): Promise<VariantDraftDocument | null> {
    return this.models.VariantDraft.findById(id)
      .session(options.session ?? null)
      .exec();
  }

  async requireById(
    id: string | Types.ObjectId,
    options: QueryOptions = {},
  ): Promise<VariantDraftDocument> {
    const variant = await this.findById(id, options);
    if (!variant)
      throw new DigikalaDocumentNotFoundError('VariantDraft', String(id));
    return variant;
  }

  async replace(
    id: string | Types.ObjectId,
    input: VariantDraftInput,
    options: MutationOptions = {},
  ): Promise<VariantDraftDocument> {
    const variant = await this.requireById(id, options);
    variant.overwrite({
      ...VariantDraftInputSchema.parse(input),
      schemaVersion: variant.schemaVersion,
    });
    try {
      return await variant.save(options);
    } catch (error) {
      translateWriteError(error, 'VariantDraft', String(id));
    }
  }

  async buildPublicationPayload(
    id: string | Types.ObjectId,
    remoteProductId: number,
  ): Promise<VariantPublicationPayload> {
    const variant = await this.requireById(id);
    const data = VariantDraftInputSchema.parse(
      variantDraftInputFromDocument(variant),
    );
    return buildVariantPublicationPayload(data, remoteProductId);
  }
}

export class CategoryRuleRepository {
  constructor(private readonly models: DigikalaMongooseModels) {}

  findByCategoryId(
    categoryId: number,
    options: QueryOptions = {},
  ): Promise<CategoryRuleDocument | null> {
    return this.models.CategoryRule.findOne({ categoryId })
      .session(options.session ?? null)
      .exec();
  }

  async upsert(
    input: CategoryRuleInput,
    options: MutationOptions = {},
  ): Promise<CategoryRuleDocument> {
    const data = CategoryRuleInputSchema.parse(input);
    const result = await translatedWrite(
      () =>
        this.models.CategoryRule.findOneAndUpdate(
          { categoryId: data.categoryId },
          { $set: data },
          {
            returnDocument: 'after',
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true,
            session: options.session,
          },
        ).exec(),
      'CategoryRule',
      String(data.categoryId),
    );
    if (!result) {
      throw new DigikalaDocumentNotFoundError(
        'CategoryRule',
        String(data.categoryId),
      );
    }
    return result as CategoryRuleDocument;
  }

  async isFresh(categoryId: number, now = new Date()): Promise<boolean> {
    const rule = await this.findByCategoryId(categoryId);
    return Boolean(rule && (!rule.expiresAt || rule.expiresAt > now));
  }
}

export class PublicationRepository {
  constructor(private readonly models: DigikalaMongooseModels) {}

  findForProduct(
    panelKey: string,
    productId: string | Types.ObjectId,
  ): Promise<PublicationDocument | null> {
    return this.models.Publication.findOne({
      panelKey,
      productId,
      variantId: { $exists: false },
    }).exec();
  }

  findForVariant(
    panelKey: string,
    productId: string | Types.ObjectId,
    variantId: string | Types.ObjectId,
  ): Promise<PublicationDocument | null> {
    return this.models.Publication.findOne({
      panelKey,
      productId,
      variantId,
    }).exec();
  }

  async list(
    options: PublicationListOptions = {},
  ): Promise<Page<PublicationDocument>> {
    const { limit, after } = pagination(options);
    const productId = objectIdFilter(options.productId, 'productId');
    const filter: RepositoryFilter = {
      ...(after ? { _id: { $gt: after } } : {}),
      ...(options.panelKey ? { panelKey: options.panelKey } : {}),
      ...(productId ? { productId } : {}),
      ...(options.status ? { status: options.status } : {}),
    };
    const items = await this.models.Publication.find(filter)
      .sort({ _id: 1 })
      .limit(limit + 1)
      .session(options.session ?? null)
      .exec();
    return page(items, limit);
  }

  async archive(
    id: string | Types.ObjectId,
    options: MutationOptions = {},
  ): Promise<PublicationDocument> {
    const document = await this.models.Publication.findByIdAndUpdate(
      id,
      {
        $set: { status: 'archived' },
        $push: { statusHistory: { status: 'archived', at: new Date() } },
      },
      {
        returnDocument: 'after',
        runValidators: true,
        session: options.session,
      },
    ).exec();
    if (!document)
      throw new DigikalaDocumentNotFoundError('Publication', String(id));
    return document;
  }

  async update(
    id: string | Types.ObjectId,
    input: PublicationUpdate,
    options: MutationOptions = {},
  ): Promise<PublicationDocument> {
    const data = PublicationUpdateSchema.parse(input);
    const { status, ...fields } = data;
    const set = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value != null),
    );
    const unset = Object.fromEntries(
      Object.entries(fields)
        .filter(([, value]) => value === null)
        .map(([field]) => [field, 1]),
    );
    if (status !== undefined) set.status = status;
    const update = {
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
      ...(status === undefined
        ? {}
        : { $push: { statusHistory: { status, at: new Date() } } }),
    };
    const document = await translatedWrite(
      () =>
        this.models.Publication.findByIdAndUpdate(id, update, {
          returnDocument: 'after',
          runValidators: true,
          session: options.session,
        }).exec(),
      'Publication',
      String(id),
    );
    if (!document) {
      throw new DigikalaDocumentNotFoundError('Publication', String(id));
    }
    return document as PublicationDocument;
  }

  async upsert(
    input: PublicationInput,
    options: MutationOptions = {},
  ): Promise<PublicationDocument> {
    const data = PublicationInputSchema.parse(input);
    const identity = data.variantId
      ? {
          panelKey: data.panelKey,
          productId: data.productId,
          variantId: data.variantId,
        }
      : {
          panelKey: data.panelKey,
          productId: data.productId,
          variantId: { $exists: false },
        };
    const { status, ...withoutStatus } = data;
    const update =
      input.status === undefined
        ? { $set: withoutStatus, $setOnInsert: { status } }
        : {
            $set: data,
            $push: { statusHistory: { status, at: new Date() } },
          };
    const identifier = `${data.panelKey}:${data.variantId ?? data.productId}`;
    const result = await translatedWrite(
      () =>
        this.models.Publication.findOneAndUpdate(identity, update, {
          returnDocument: 'after',
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
          session: options.session,
        }).exec(),
      'Publication',
      identifier,
    );
    if (!result) {
      throw new DigikalaDocumentNotFoundError('Publication', identifier);
    }
    return result as PublicationDocument;
  }
}

export class CreationWorkflowRepository {
  constructor(private readonly models: DigikalaMongooseModels) {}

  find(
    panelKey: string,
    productId: string | Types.ObjectId,
  ): Promise<CreationWorkflowDocument | null> {
    return this.models.CreationWorkflow.findOne({ panelKey, productId }).exec();
  }

  async save(
    panelKey: string,
    productId: string | Types.ObjectId,
    state: CreationWorkflowState,
    options: MutationOptions = {},
  ): Promise<CreationWorkflowDocument> {
    const parsed = CreationWorkflowStateSchema.parse(state);
    const identifier = `${panelKey}:${String(productId)}`;
    const result = await translatedWrite(
      () =>
        this.models.CreationWorkflow.findOneAndUpdate(
          { panelKey, productId },
          { $set: { state: parsed } },
          {
            returnDocument: 'after',
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true,
            session: options.session,
          },
        ).exec(),
      'CreationWorkflow',
      identifier,
    );
    if (!result) {
      throw new DigikalaDocumentNotFoundError('CreationWorkflow', identifier);
    }
    return result as CreationWorkflowDocument;
  }
}

export interface DigikalaMongooseRepositories {
  products: ProductDraftRepository;
  variants: VariantDraftRepository;
  categories: CategoryRuleRepository;
  publications: PublicationRepository;
  workflows: CreationWorkflowRepository;
}

export function createDigikalaRepositories(
  models: DigikalaMongooseModels,
): DigikalaMongooseRepositories {
  const categories = new CategoryRuleRepository(models);
  return {
    categories,
    products: new ProductDraftRepository(models, categories),
    variants: new VariantDraftRepository(models),
    publications: new PublicationRepository(models),
    workflows: new CreationWorkflowRepository(models),
  };
}
