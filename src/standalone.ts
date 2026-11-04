import { randomUUID } from 'node:crypto';
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
  DigikalaDuplicateIdentityError,
  DigikalaIdentityConflictError,
  DigikalaStandaloneOperationError,
  type DigikalaStandaloneProgress,
} from './errors.js';
import {
  publicationInputFromDocument,
  productDraftInputFromDocument,
  variantDraftInputFromDocument,
  type DigikalaMongooseRepositories,
} from './repositories.js';
import type {
  ProductDraftDocument,
  PublicationDocument,
  VariantDraftDocument,
} from './types.js';
import type { DigikalaMongooseObserver } from './types.js';

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
  ensureCatalogs(
    inputs: readonly StandaloneCatalogInput[],
    options?: StandaloneBulkOptions,
  ): Promise<StandaloneBulkResult>;
  inspectCatalog(input: StandaloneCatalogInput): Promise<CatalogInspection>;
}

export type CatalogInspectionStatus = 'missing' | 'matching' | 'conflict';

export interface CatalogInspectionItem {
  entity: 'product' | 'variant' | 'publication';
  key: string;
  status: CatalogInspectionStatus;
  documentId?: string;
}

export interface CatalogInspection {
  consistent: boolean;
  repairable: boolean;
  items: CatalogInspectionItem[];
}

export interface StandaloneBulkOptions {
  concurrency?: number;
}

export type StandaloneBulkItemResult =
  | { index: number; ok: true; value: StandaloneCatalogResult }
  | { index: number; ok: false; error: unknown };

export interface StandaloneBulkResult {
  items: StandaloneBulkItemResult[];
  succeeded: number;
  failed: number;
}

export interface DigikalaStandaloneOrchestratorOptions {
  observer?: DigikalaMongooseObserver;
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
  const publicationKeys = new Set<string>();
  for (const publication of publications) {
    if (publication.variantKey && !variantKeys.has(publication.variantKey)) {
      throw new DigikalaIdentityConflictError(
        'publication',
        `${publication.panelKey}:${publication.variantKey}`,
        `Publication references a variant not present in the request: ${publication.variantKey}`,
      );
    }
    const key = publicationKey(publication);
    if (publicationKeys.has(key)) {
      throw new DigikalaIdentityConflictError(
        'publication',
        key,
        `Publication identity is duplicated in the standalone request: ${key}`,
      );
    }
    publicationKeys.add(key);
  }
  return { product, variants, publications };
}

function isDuplicateKey(error: unknown): boolean {
  if (error instanceof DigikalaDuplicateIdentityError) return true;
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
  return JSON.stringify([publication.panelKey, publication.variantKey ?? null]);
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

function samePublication(
  document: PublicationDocument,
  expected: PublicationData,
): boolean {
  return isDeepStrictEqual(
    PublicationInputSchema.parse(publicationInputFromDocument(document)),
    expected,
  );
}

function errorSummary(error: unknown): {
  name: string;
  message: string;
  code?: string;
} {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', message: String(error) };
  }
  const code = (error as Error & { code?: unknown }).code;
  return {
    name: error.name,
    message: error.message,
    ...(typeof code === 'string' ? { code } : {}),
  };
}

export function createDigikalaStandaloneOrchestrator(
  repositories: DigikalaMongooseRepositories,
  options: DigikalaStandaloneOrchestratorOptions = {},
): DigikalaStandaloneOrchestrator {
  const emit = async (
    event: Omit<
      Parameters<DigikalaMongooseObserver['onEvent']>[0],
      'eventId' | 'timestamp'
    >,
  ): Promise<void> => {
    try {
      await options.observer?.onEvent({
        ...event,
        eventId: randomUUID(),
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Telemetry must never change persistence outcomes.
    }
  };
  const orchestrator: DigikalaStandaloneOrchestrator = {
    async ensureCatalog(input) {
      const started = Date.now();
      await emit({
        operation: 'standalone.ensureCatalog',
        phase: 'started',
        productKey: input.product.key,
      });
      let parsed: ParsedStandaloneInput;
      try {
        parsed = parseInput(input);
      } catch (error) {
        await emit({
          operation: 'standalone.ensureCatalog',
          phase: 'failed',
          productKey: input.product.key,
          durationMs: Date.now() - started,
          error: errorSummary(error),
        });
        throw error;
      }
      const variants: StandaloneCatalogResult['variants'] = [];
      const publications: StandaloneCatalogResult['publications'] = [];
      let product: ProductDraftDocument | undefined;
      let productCreated = false;
      let step = 'product';

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
          step = `variant:${variantInput.key}`;
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
          step = `publication:${key}`;
          const variant = publicationInput.variantKey
            ? variantsByKey.get(publicationInput.variantKey)
            : undefined;
          const existing = variant
            ? await repositories.publications.findForVariant(
                publicationInput.panelKey,
                product.id,
                variant.id,
              )
            : await repositories.publications.findForProduct(
                publicationInput.panelKey,
                product.id,
              );
          let created = !existing;
          const { variantKey: _variantKey, ...publication } = publicationInput;
          void _variantKey;
          const expected = PublicationInputSchema.parse({
            ...publication,
            productId: product.id,
            ...(variant ? { variantId: variant.id } : {}),
          });
          if (existing && !samePublication(existing, expected)) {
            throw new DigikalaIdentityConflictError('publication', key);
          }
          let document: PublicationDocument;
          if (existing) {
            document = existing;
            publications.push({ key, document, created: false });
            continue;
          }
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
                  product.id,
                  variant.id,
                )
              : await repositories.publications.findForProduct(
                  publicationInput.panelKey,
                  product.id,
                );
            if (!raced) {
              throw new DigikalaIdentityConflictError('publication', key);
            }
            if (!samePublication(raced, expected)) {
              throw new DigikalaIdentityConflictError('publication', key);
            }
            created = false;
            document = raced;
          }
          publications.push({ key, document, created });
        }

        const result = {
          product: { document: product, created: productCreated },
          variants,
          publications,
          resumed:
            !productCreated ||
            variants.some((item) => !item.created) ||
            publications.some((item) => !item.created),
        };
        await emit({
          operation: 'standalone.ensureCatalog',
          phase: 'succeeded',
          productKey: parsed.product.key,
          durationMs: Date.now() - started,
        });
        return result;
      } catch (error) {
        const surfaced =
          error instanceof DigikalaIdentityConflictError
            ? error
            : new DigikalaStandaloneOperationError(
                step,
                progressFor(
                  parsed.product.key,
                  product?.id,
                  variants,
                  publications,
                ),
                { cause: error },
              );
        await emit({
          operation: 'standalone.ensureCatalog',
          phase: 'failed',
          productKey: parsed.product.key,
          durationMs: Date.now() - started,
          error: errorSummary(surfaced),
        });
        throw surfaced;
      }
    },
    async ensureCatalogs(inputs, options = {}) {
      const concurrency = options.concurrency ?? 4;
      if (
        !Number.isInteger(concurrency) ||
        concurrency < 1 ||
        concurrency > 32
      ) {
        throw new RangeError(
          'Standalone bulk concurrency must be an integer between 1 and 32',
        );
      }
      const items = new Array<StandaloneBulkItemResult>(inputs.length);
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < inputs.length) {
          const index = cursor++;
          try {
            items[index] = {
              index,
              ok: true,
              value: await orchestrator.ensureCatalog(inputs[index]!),
            };
          } catch (error) {
            items[index] = { index, ok: false, error };
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, inputs.length) }, worker),
      );
      const succeeded = items.filter((item) => item.ok).length;
      return {
        items,
        succeeded,
        failed: items.length - succeeded,
      };
    },
    async inspectCatalog(input) {
      const parsed = parseInput(input);
      const items: CatalogInspectionItem[] = [];
      const product = await repositories.products.findByKey(parsed.product.key);
      items.push({
        entity: 'product',
        key: parsed.product.key,
        status: !product
          ? 'missing'
          : sameProduct(product, parsed.product)
            ? 'matching'
            : 'conflict',
        ...(product ? { documentId: product.id } : {}),
      });

      const variantsByKey = new Map<string, VariantDraftDocument>();
      for (const variantInput of parsed.variants) {
        const variant = await repositories.variants.findByKey(variantInput.key);
        if (variant) variantsByKey.set(variantInput.key, variant);
        const matches = Boolean(
          variant &&
          product &&
          String(variant.productId) === product.id &&
          sameVariant(variant, variantInput),
        );
        items.push({
          entity: 'variant',
          key: variantInput.key,
          status: !variant ? 'missing' : matches ? 'matching' : 'conflict',
          ...(variant ? { documentId: variant.id } : {}),
        });
      }

      for (const publicationInput of parsed.publications) {
        const key = publicationKey(publicationInput);
        const variant = publicationInput.variantKey
          ? variantsByKey.get(publicationInput.variantKey)
          : undefined;
        if (!product || (publicationInput.variantKey && !variant)) {
          items.push({ entity: 'publication', key, status: 'missing' });
          continue;
        }
        const publication = variant
          ? await repositories.publications.findForVariant(
              publicationInput.panelKey,
              product.id,
              variant.id,
            )
          : await repositories.publications.findForProduct(
              publicationInput.panelKey,
              product.id,
            );
        const { variantKey: _variantKey, ...publicationData } =
          publicationInput;
        void _variantKey;
        const expected = PublicationInputSchema.parse({
          ...publicationData,
          productId: product.id,
          ...(variant ? { variantId: variant.id } : {}),
        });
        items.push({
          entity: 'publication',
          key,
          status: !publication
            ? 'missing'
            : samePublication(publication, expected)
              ? 'matching'
              : 'conflict',
          ...(publication ? { documentId: publication.id } : {}),
        });
      }

      return {
        consistent: items.every((item) => item.status === 'matching'),
        repairable: items.every((item) => item.status !== 'conflict'),
        items,
      };
    },
  };
  return orchestrator;
}
