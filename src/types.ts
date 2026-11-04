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
  schemaVersion: number;
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
  schemaVersion: number;
  productId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryRuleRecord {
  schemaVersion: number;
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
  schemaVersion: number;
  statusHistory: Array<{
    status: PublicationData['status'];
    at: Date;
  }>;
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreationWorkflowRecord {
  schemaVersion: number;
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
  observer?: DigikalaMongooseObserver;
}

export interface DigikalaMongooseEvent {
  operation: 'standalone.ensureCatalog';
  phase: 'started' | 'succeeded' | 'failed';
  productKey: string;
  durationMs?: number;
  error?: unknown;
}

export interface DigikalaMongooseObserver {
  onEvent(event: DigikalaMongooseEvent): void | Promise<void>;
}

export interface ProductPublicationPayloads {
  details: ProductDetailsInput;
  title?: ProductTitleInput;
  attributes?: ProductAttributesInput;
  save: ProductSaveInput;
}

export type VariantPublicationPayload = VariantCreateInput;
