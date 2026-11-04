import {
  CreationWorkflowStateSchema,
  type CreationWorkflowState,
} from 'digikala/schemas';
import type { ClientSession, Types } from 'mongoose';
import {
  CategoryRuleInputSchema,
  ProductDraftInputSchema,
  PublicationInputSchema,
  VariantDraftInputSchema,
  type CategoryRuleInput,
  type ProductDraftInput,
  type PublicationInput,
  type VariantDraftInput,
} from './contracts.js';
import { DigikalaDocumentNotFoundError } from './errors.js';
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

export interface MutationOptions {
  session?: ClientSession;
}

function productInput(document: ProductDraftDocument): ProductDraftInput {
  return {
    key: document.key,
    status: document.status,
    details: document.details,
    ...(document.title ? { title: document.title } : {}),
    ...(document.attributes ? { attributes: document.attributes } : {}),
    ...(document.saveOptions ? { saveOptions: document.saveOptions } : {}),
    images: document.images,
    ...(document.metadata ? { metadata: document.metadata } : {}),
  };
}

function variantInput(document: VariantDraftDocument): VariantDraftInput {
  return {
    key: document.key,
    productId: String(document.productId),
    status: document.status,
    input: document.input,
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
    const [created] = await this.models.ProductDraft.create(
      [{ ...data, validation: { valid: false, issues: [] } }],
      options,
    );
    return created!;
  }

  findByKey(key: string): Promise<ProductDraftDocument | null> {
    return this.models.ProductDraft.findOne({ key }).exec();
  }

  findById(id: string | Types.ObjectId): Promise<ProductDraftDocument | null> {
    return this.models.ProductDraft.findById(id).exec();
  }

  async requireById(
    id: string | Types.ObjectId,
  ): Promise<ProductDraftDocument> {
    const product = await this.findById(id);
    if (!product)
      throw new DigikalaDocumentNotFoundError('ProductDraft', String(id));
    return product;
  }

  async replace(
    id: string | Types.ObjectId,
    input: ProductDraftInput,
    options: MutationOptions = {},
  ): Promise<ProductDraftDocument> {
    const product = await this.requireById(id);
    product.set(ProductDraftInputSchema.parse(input));
    product.validation = { valid: false, issues: [] };
    return product.save(options);
  }

  async validateForPublication(
    id: string | Types.ObjectId,
    options: MutationOptions & { persist?: boolean } = {},
  ): Promise<CategoryValidationResult> {
    const product = await this.requireById(id);
    const plain = productInput(product);
    const category = await this.categories.findByCategoryId(
      product.details.categoryId,
    );
    const result = validateProductDraft(plain, category?.toObject());
    if (options.persist !== false) {
      product.validation = {
        valid: result.valid,
        issues: result.issues,
        ...(result.ruleVersion ? { ruleVersion: result.ruleVersion } : {}),
        validatedAt: new Date(),
      };
      await product.save({ session: options.session });
    }
    return result;
  }

  async buildPublicationPayloads(
    id: string | Types.ObjectId,
    remoteDraftProductId: number,
  ): Promise<ProductPublicationPayloads> {
    const product = await this.requireById(id);
    return buildProductPublicationPayloads(
      ProductDraftInputSchema.parse(productInput(product)),
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
    const [created] = await this.models.VariantDraft.create([data], options);
    return created!;
  }

  findByKey(key: string): Promise<VariantDraftDocument | null> {
    return this.models.VariantDraft.findOne({ key }).exec();
  }

  findById(id: string | Types.ObjectId): Promise<VariantDraftDocument | null> {
    return this.models.VariantDraft.findById(id).exec();
  }

  async requireById(
    id: string | Types.ObjectId,
  ): Promise<VariantDraftDocument> {
    const variant = await this.findById(id);
    if (!variant)
      throw new DigikalaDocumentNotFoundError('VariantDraft', String(id));
    return variant;
  }

  async buildPublicationPayload(
    id: string | Types.ObjectId,
    remoteProductId: number,
  ): Promise<VariantPublicationPayload> {
    const variant = await this.requireById(id);
    const data = VariantDraftInputSchema.parse(variantInput(variant));
    return buildVariantPublicationPayload(data, remoteProductId);
  }
}

export class CategoryRuleRepository {
  constructor(private readonly models: DigikalaMongooseModels) {}

  findByCategoryId(categoryId: number): Promise<CategoryRuleDocument | null> {
    return this.models.CategoryRule.findOne({ categoryId }).exec();
  }

  async upsert(
    input: CategoryRuleInput,
    options: MutationOptions = {},
  ): Promise<CategoryRuleDocument> {
    const data = CategoryRuleInputSchema.parse(input);
    const result = await this.models.CategoryRule.findOneAndUpdate(
      { categoryId: data.categoryId },
      { $set: data },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        session: options.session,
      },
    ).exec();
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
    variantId: string | Types.ObjectId,
  ): Promise<PublicationDocument | null> {
    return this.models.Publication.findOne({ panelKey, variantId }).exec();
  }

  async upsert(
    input: PublicationInput,
    options: MutationOptions = {},
  ): Promise<PublicationDocument> {
    const data = PublicationInputSchema.parse(input);
    const identity = data.variantId
      ? { panelKey: data.panelKey, variantId: data.variantId }
      : {
          panelKey: data.panelKey,
          productId: data.productId,
          variantId: { $exists: false },
        };
    const result = await this.models.Publication.findOneAndUpdate(
      identity,
      { $set: data },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        session: options.session,
      },
    ).exec();
    if (!result) {
      throw new DigikalaDocumentNotFoundError(
        'Publication',
        `${data.panelKey}:${data.variantId ?? data.productId}`,
      );
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
    const result = await this.models.CreationWorkflow.findOneAndUpdate(
      { panelKey, productId },
      { $set: { state: parsed } },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        session: options.session,
      },
    ).exec();
    if (!result) {
      throw new DigikalaDocumentNotFoundError(
        'CreationWorkflow',
        `${panelKey}:${String(productId)}`,
      );
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
