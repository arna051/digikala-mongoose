import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  ProductDraftInputSchema,
  PublicationInputSchema,
  VariantDraftInputSchema,
  type ProductDraftData,
  type ProductDraftInput,
  type PublicationData,
  type PublicationInput,
  type VariantDraftData,
  type VariantDraftInput,
} from './contracts.js';
import {
  DigikalaIdentityConflictError,
  DigikalaStandaloneOperationError,
  type DigikalaStandaloneProgress,
} from './errors.js';
import {
  productDraftInputFromDocument,
  variantDraftInputFromDocument,
  type DigikalaMongooseRepositories,
} from './repositories.js';
import type {
  ProductDraftDocument,
  PublicationDocument,
  VariantDraftDocument,
} from './types.js';

const standaloneVariantSchema = VariantDraftInputSchema.omit({
  productId: true,
});

const standalonePublicationSchema = PublicationInputSchema.omit({
  productId: true,
  variantId: true,
}).extend({
  variantKey: z.string().trim().min(1).max(160).optional(),
});

export type StandaloneVariantInput = Omit<VariantDraftInput, 'productId'>;
export type StandalonePublicationInput = Omit<
  PublicationInput,
  'productId' | 'variantId'
> & { variantKey?: string };

export interface StandaloneCatalogInput {
  product: ProductDraftInput;
  variants?: readonly StandaloneVariantInput[];
  publications?: readonly StandalonePublicationInput[];
}

export interface StandaloneCatalogResult {
  product: { document: ProductDraftDocument; created: boolean };
  variants: Array<{
    key: string;
    document: VariantDraftDocument;
    created: boolean;
  }>;
  publications: Array<{
    key: string;
    document: PublicationDocument;
    created: boolean;
  }>;
  resumed: boolean;
}

export interface DigikalaStandaloneOrchestrator {
  ensureCatalog(
    input: StandaloneCatalogInput,
  ): Promise<StandaloneCatalogResult>;
}

interface ParsedStandaloneInput {
  product: ProductDraftData;
  variants: Array<Omit<VariantDraftData, 'productId'>>;
  publications: Array<
    Omit<PublicationData, 'productId' | 'variantId'> & { variantKey?: string }
  >;
}

function parseInput(input: StandaloneCatalogInput): ParsedStandaloneInput {
  const product = ProductDraftInputSchema.parse(input.product);
  const variants = (input.variants ?? []).map((variant) =>
    standaloneVariantSchema.parse(variant),
  );
  const publications = (input.publications ?? []).map((publication) =>
    standalonePublicationSchema.parse(publication),
  );

  const variantKeys = new Set<string>();
  for (const variant of variants) {
    if (variantKeys.has(variant.key)) {
      throw new DigikalaIdentityConflictError(
        'variant',
        variant.key,
        `Variant key is duplicated in the standalone request: ${variant.key}`,
      );
    }
    variantKeys.add(variant.key);
  }
  for (const publication of publications) {
    if (publication.variantKey && !variantKeys.has(publication.variantKey)) {
      throw new DigikalaIdentityConflictError(
        'publication',
        `${publication.panelKey}:${publication.variantKey}`,
        `Publication references a variant not present in the request: ${publication.variantKey}`,
      );
    }
  }
  return { product, variants, publications };
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

function publicationKey(
  publication: ParsedStandaloneInput['publications'][number],
): string {
  return `${publication.panelKey}:${publication.variantKey ?? 'product'}`;
}

function progressFor(
  productKey: string,
  productId: string | undefined,
  variants: StandaloneCatalogResult['variants'],
  publications: StandaloneCatalogResult['publications'],
): DigikalaStandaloneProgress {
  return {
    productKey,
    ...(productId ? { productId } : {}),
    completedVariantKeys: variants.map((item) => item.key),
    completedPublicationKeys: publications.map((item) => item.key),
  };
}

function sameProduct(
  document: ProductDraftDocument,
  expected: ProductDraftData,
): boolean {
  return isDeepStrictEqual(
    ProductDraftInputSchema.parse(productDraftInputFromDocument(document)),
    expected,
  );
}

function sameVariant(
  document: VariantDraftDocument,
  expected: Omit<VariantDraftData, 'productId'>,
): boolean {
  const actual = VariantDraftInputSchema.parse(
    variantDraftInputFromDocument(document),
  );
  const { productId: _productId, ...withoutProductId } = actual;
  void _productId;
  return isDeepStrictEqual(withoutProductId, expected);
}

export function createDigikalaStandaloneOrchestrator(
  repositories: DigikalaMongooseRepositories,
): DigikalaStandaloneOrchestrator {
  return {
    async ensureCatalog(input) {
      const parsed = parseInput(input);
      const variants: StandaloneCatalogResult['variants'] = [];
      const publications: StandaloneCatalogResult['publications'] = [];
      let product: ProductDraftDocument | undefined;
      let productCreated = false;

      try {
        product =
          (await repositories.products.findByKey(parsed.product.key)) ??
          undefined;
        if (!product) {
          try {
            product = await repositories.products.create(parsed.product);
            productCreated = true;
          } catch (error) {
            if (!isDuplicateKey(error)) throw error;
            product =
              (await repositories.products.findByKey(parsed.product.key)) ??
              undefined;
            if (!product) throw error;
          }
        }
        if (!sameProduct(product, parsed.product)) {
          throw new DigikalaIdentityConflictError(
            'product',
            parsed.product.key,
          );
        }

        for (const variantInput of parsed.variants) {
          let document = await repositories.variants.findByKey(
            variantInput.key,
          );
          let created = false;
          if (!document) {
            try {
              document = await repositories.variants.create({
                ...variantInput,
                productId: product.id,
              });
              created = true;
            } catch (error) {
              if (!isDuplicateKey(error)) throw error;
              document = await repositories.variants.findByKey(
                variantInput.key,
              );
              if (!document) throw error;
            }
          }
          if (
            String(document.productId) !== product.id ||
            !sameVariant(document, variantInput)
          ) {
            throw new DigikalaIdentityConflictError(
              'variant',
              variantInput.key,
            );
          }
          variants.push({ key: variantInput.key, document, created });
        }

        const variantsByKey = new Map(
          variants.map((item) => [item.key, item.document] as const),
        );
        for (const publicationInput of parsed.publications) {
          const key = publicationKey(publicationInput);
          const variant = publicationInput.variantKey
            ? variantsByKey.get(publicationInput.variantKey)
            : undefined;
          const existing = variant
            ? await repositories.publications.findForVariant(
                publicationInput.panelKey,
                variant.id,
              )
            : await repositories.publications.findForProduct(
                publicationInput.panelKey,
                product.id,
              );
          let created = !existing;
          const { variantKey: _variantKey, ...publication } = publicationInput;
          void _variantKey;
          let document: PublicationDocument;
          try {
            document = await repositories.publications.upsert({
              ...publication,
              productId: product.id,
              ...(variant ? { variantId: variant.id } : {}),
            });
          } catch (error) {
            if (!isDuplicateKey(error)) throw error;
            const raced = variant
              ? await repositories.publications.findForVariant(
                  publicationInput.panelKey,
                  variant.id,
                )
              : await repositories.publications.findForProduct(
                  publicationInput.panelKey,
                  product.id,
                );
            if (!raced) {
              throw new DigikalaIdentityConflictError('publication', key);
            }
            created = false;
            document = await repositories.publications.upsert({
              ...publication,
              productId: product.id,
              ...(variant ? { variantId: variant.id } : {}),
            });
          }
          publications.push({ key, document, created });
        }

        return {
          product: { document: product, created: productCreated },
          variants,
          publications,
          resumed:
            !productCreated ||
            variants.some((item) => !item.created) ||
            publications.some((item) => !item.created),
        };
      } catch (error) {
        if (error instanceof DigikalaIdentityConflictError) throw error;
        throw new DigikalaStandaloneOperationError(
          product
            ? variants.length < parsed.variants.length
              ? 'variants'
              : 'publications'
            : 'product',
          progressFor(parsed.product.key, product?.id, variants, publications),
          { cause: error },
        );
      }
    },
  };
}
