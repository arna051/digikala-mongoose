import type {
  CreationWorkflowState,
  ProductAttributesInput,
  ProductDetailsInput,
  ProductSaveInput,
  ProductTitleInput,
  VariantCreateInput,
} from 'digikala/schemas';
import type { Connection, HydratedDocument, Model, Types } from 'mongoose';
import type {
  CategoryAttributeRule,
  CategoryFieldRule,
  ProductDraftData,
  PublicationData,
  VariantDraftData,
} from './contracts.js';
import type { DigikalaCategoryValidationIssue } from './errors.js';

export interface ProductDraftRecord extends ProductDraftData {
  validation: {
    valid: boolean;
    issues: DigikalaCategoryValidationIssue[];
    ruleVersion?: string;
    validatedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface VariantDraftRecord extends Omit<
  VariantDraftData,
  'productId'
> {
  productId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryRuleRecord {
  categoryId: number;
  version: string;
  title?: string;
  fields: CategoryFieldRule[];
  attributeRules: CategoryAttributeRule[];
  sourcePayload?: unknown;
  fetchedAt: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicationRecord extends Omit<
  PublicationData,
  'productId' | 'variantId'
> {
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreationWorkflowRecord {
  panelKey: string;
  productId: Types.ObjectId;
  state: CreationWorkflowState;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductDraftDocument = HydratedDocument<ProductDraftRecord>;
export type VariantDraftDocument = HydratedDocument<VariantDraftRecord>;
export type CategoryRuleDocument = HydratedDocument<CategoryRuleRecord>;
export type PublicationDocument = HydratedDocument<PublicationRecord>;
export type CreationWorkflowDocument = HydratedDocument<CreationWorkflowRecord>;

export interface DigikalaMongooseModels {
  ProductDraft: Model<ProductDraftRecord>;
  VariantDraft: Model<VariantDraftRecord>;
  CategoryRule: Model<CategoryRuleRecord>;
  Publication: Model<PublicationRecord>;
  CreationWorkflow: Model<CreationWorkflowRecord>;
}

export interface DigikalaMongooseOptions {
  connection: Connection;
  modelPrefix?: string;
  collectionPrefix?: string;
  autoCreateIndexes?: boolean;
}

export interface ProductPublicationPayloads {
  details: ProductDetailsInput;
  title?: ProductTitleInput;
  attributes?: ProductAttributesInput;
  save: ProductSaveInput;
}

export type VariantPublicationPayload = VariantCreateInput;
