import {
  ProductAttributesInputSchema,
  ProductDetailsInputSchema,
  ProductSaveInputSchema,
  ProductTitleInputSchema,
  VariantCreateInputSchema,
  validateVariantCreationInput,
} from 'digikala/schemas';
import type {
  ProductPublicationPayloads,
  VariantPublicationPayload,
} from './types.js';
import type { ProductDraftData, VariantDraftData } from './contracts.js';

export function buildProductPublicationPayloads(
  product: ProductDraftData,
  draftProductId: number,
): ProductPublicationPayloads {
  const details = ProductDetailsInputSchema.parse({
    ...product.details,
    draftProductId,
  });
  const title = product.title
    ? ProductTitleInputSchema.parse({ ...product.title, draftProductId })
    : undefined;
  const attributes = product.attributes
    ? ProductAttributesInputSchema.parse({
        ...product.attributes,
        draftProductId,
      })
    : undefined;
  const save = ProductSaveInputSchema.parse({
    categoryId: product.details.categoryId,
    draftProductId,
    ...product.saveOptions,
  });
  return {
    details,
    ...(title ? { title } : {}),
    ...(attributes ? { attributes } : {}),
    save,
  };
}

export function buildVariantPublicationPayload(
  variant: VariantDraftData,
  remoteProductId: number,
): VariantPublicationPayload {
  const input = VariantCreateInputSchema.parse({
    productId: remoteProductId,
    ...variant.input,
  });
  return validateVariantCreationInput(input, variant.requirements);
}
