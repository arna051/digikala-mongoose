import { createHash } from 'node:crypto';
import { DigikalaMongooseError } from '../errors.js';

export type QdrantDistance = 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan';
export type QdrantPointId = string | number;

export interface QdrantPoint {
  id: QdrantPointId;
  vector: number[];
  payload?: Record<string, unknown>;
}

export interface QdrantSearchResult {
  id: QdrantPointId;
  score: number;
  payload?: Record<string, unknown> | null;
}

export interface QdrantRetrievedPoint {
  id: QdrantPointId;
  payload?: Record<string, unknown> | null;
}

/** Structural subset implemented by @qdrant/js-client-rest. */
export interface QdrantClientLike {
  getCollection(collectionName: string): Promise<unknown>;
  createCollection(
    collectionName: string,
    options: { vectors: { size: number; distance: QdrantDistance } },
  ): Promise<unknown>;
  upsert(
    collectionName: string,
    options: { wait?: boolean; points: QdrantPoint[] },
  ): Promise<unknown>;
  delete(
    collectionName: string,
    options: { wait?: boolean; points: QdrantPointId[] },
  ): Promise<unknown>;
  search(
    collectionName: string,
    options: {
      vector: number[];
      limit: number;
      filter?: unknown;
      with_payload?: boolean;
    },
  ): Promise<QdrantSearchResult[]>;
  retrieve?(
    collectionName: string,
    options: {
      ids: QdrantPointId[];
      with_payload?: boolean;
      with_vector?: boolean;
    },
  ): Promise<QdrantRetrievedPoint[]>;
}

export interface DigikalaEmbeddingProvider {
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface DigikalaQdrantOptions {
  client: QdrantClientLike;
  embeddingProvider: DigikalaEmbeddingProvider;
  vectorSize: number;
  collectionName?: string;
  distance?: QdrantDistance;
  wait?: boolean;
  batchSize?: number;
  embeddingModel?: string;
}

export interface DigikalaSemanticProduct {
  id: string;
  text: string;
  payload?: Record<string, unknown>;
}

export interface DigikalaSemanticSearchOptions {
  limit?: number;
  filter?: unknown;
}

export class DigikalaQdrantCompatibilityError extends DigikalaMongooseError {
  constructor(message: string) {
    super(`Qdrant collection is incompatible: ${message}`);
    this.name = 'DigikalaQdrantCompatibilityError';
  }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: number; statusCode?: number };
  return value.status === 404 || value.statusCode === 404;
}

export function qdrantPointId(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class DigikalaQdrantIndex {
  readonly collectionName: string;
  private readonly distance: QdrantDistance;
  private readonly wait: boolean;
  private readonly batchSize: number;
  private readonly modelMarkerId: string;

  constructor(private readonly options: DigikalaQdrantOptions) {
    if (!Number.isInteger(options.vectorSize) || options.vectorSize <= 0) {
      throw new DigikalaMongooseError(
        'Qdrant vectorSize must be a positive integer',
      );
    }
    this.collectionName = options.collectionName?.trim() ?? 'digikala_products';
    if (!this.collectionName) {
      throw new DigikalaMongooseError(
        'Qdrant collectionName must not be empty',
      );
    }
    this.distance = options.distance ?? 'Cosine';
    if (!['Cosine', 'Euclid', 'Dot', 'Manhattan'].includes(this.distance)) {
      throw new DigikalaMongooseError(
        `Unsupported Qdrant distance: ${String(this.distance)}`,
      );
    }
    this.wait = options.wait ?? true;
    this.batchSize = options.batchSize ?? 100;
    if (!Number.isInteger(this.batchSize) || this.batchSize <= 0) {
      throw new DigikalaMongooseError(
        'Qdrant batchSize must be a positive integer',
      );
    }
    if (
      options.embeddingModel !== undefined &&
      !options.embeddingModel.trim()
    ) {
      throw new DigikalaMongooseError(
        'Qdrant embeddingModel must not be empty',
      );
    }
    this.modelMarkerId = qdrantPointId(
      `digikala-mongoose:config:${this.collectionName}`,
    );
  }

  async ensureCollection(): Promise<void> {
    try {
      const information = await this.options.client.getCollection(
        this.collectionName,
      );
      this.assertCompatible(information);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await this.options.client.createCollection(this.collectionName, {
        vectors: { size: this.options.vectorSize, distance: this.distance },
      });
    }
    await this.ensureEmbeddingModel();
  }

  private async ensureEmbeddingModel(): Promise<void> {
    const model = this.options.embeddingModel?.trim();
    if (!model) return;
    if (!this.options.client.retrieve) {
      throw new DigikalaQdrantCompatibilityError(
        'embeddingModel verification requires client.retrieve()',
      );
    }
    const [marker] = await this.options.client.retrieve(this.collectionName, {
      ids: [this.modelMarkerId],
      with_payload: true,
      with_vector: false,
    });
    if (marker) {
      if (marker.payload?._digikalaEmbeddingModel !== model) {
        throw new DigikalaQdrantCompatibilityError(
          `expected embedding model ${model} but found ${String(marker.payload?._digikalaEmbeddingModel)}`,
        );
      }
      return;
    }
    await this.options.client.upsert(this.collectionName, {
      wait: this.wait,
      points: [
        {
          id: this.modelMarkerId,
          vector: Array.from({ length: this.options.vectorSize }, () => 0),
          payload: {
            _digikalaConfig: true,
            _digikalaEmbeddingModel: model,
          },
        },
      ],
    });
  }

  private assertCompatible(information: unknown): void {
    const root = information as {
      result?: unknown;
      config?: { params?: { vectors?: unknown } };
    };
    const value = (root?.result ?? root) as {
      config?: { params?: { vectors?: unknown } };
    };
    const vectors = value?.config?.params?.vectors as
      { size?: unknown; distance?: unknown } | undefined;
    if (!vectors || typeof vectors.size !== 'number') {
      throw new DigikalaQdrantCompatibilityError(
        'could not read the unnamed vector configuration',
      );
    }
    if (vectors.size !== this.options.vectorSize) {
      throw new DigikalaQdrantCompatibilityError(
        `expected ${this.options.vectorSize} dimensions but found ${vectors.size}`,
      );
    }
    if (vectors.distance !== this.distance) {
      throw new DigikalaQdrantCompatibilityError(
        `expected ${this.distance} distance but found ${String(vectors.distance)}`,
      );
    }
  }

  async upsert(products: readonly DigikalaSemanticProduct[]): Promise<void> {
    if (products.length === 0) return;
    const vectors = await this.options.embeddingProvider.embed(
      products.map((product) => product.text),
    );
    if (vectors.length !== products.length) {
      throw new DigikalaMongooseError(
        'Embedding provider returned a different number of vectors',
      );
    }
    const points = products.map((product, index): QdrantPoint => {
      const vector = vectors[index]!;
      if (vector.length !== this.options.vectorSize) {
        throw new DigikalaMongooseError(
          `Embedding dimension ${vector.length} does not match Qdrant vectorSize ${this.options.vectorSize}`,
        );
      }
      return {
        id: qdrantPointId(product.id),
        vector,
        payload: {
          ...product.payload,
          mongoId: product.id,
          ...(this.options.embeddingModel
            ? { _digikalaEmbeddingModel: this.options.embeddingModel }
            : {}),
        },
      };
    });
    for (let offset = 0; offset < points.length; offset += this.batchSize) {
      await this.options.client.upsert(this.collectionName, {
        wait: this.wait,
        points: points.slice(offset, offset + this.batchSize),
      });
    }
  }

  async remove(productIds: readonly string[]): Promise<void> {
    if (productIds.length === 0) return;
    await this.options.client.delete(this.collectionName, {
      wait: this.wait,
      points: productIds.map(qdrantPointId),
    });
  }

  async search(
    query: string,
    options: DigikalaSemanticSearchOptions = {},
  ): Promise<QdrantSearchResult[]> {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new DigikalaMongooseError(
        'Qdrant search limit must be an integer between 1 and 1000',
      );
    }
    const [vector] = await this.options.embeddingProvider.embed([query]);
    if (!vector || vector.length !== this.options.vectorSize) {
      throw new DigikalaMongooseError(
        'Embedding provider returned an invalid query vector',
      );
    }
    const suppliedFilter =
      options.filter && typeof options.filter === 'object'
        ? (options.filter as Record<string, unknown>)
        : undefined;
    const filter = this.options.embeddingModel
      ? {
          ...suppliedFilter,
          must_not: [
            ...(Array.isArray(suppliedFilter?.must_not)
              ? suppliedFilter.must_not
              : []),
            { key: '_digikalaConfig', match: { value: true } },
          ],
        }
      : options.filter;
    return this.options.client.search(this.collectionName, {
      vector,
      limit,
      ...(filter === undefined ? {} : { filter }),
      with_payload: true,
    });
  }
}

export function createDigikalaQdrantIndex(
  options: DigikalaQdrantOptions,
): DigikalaQdrantIndex {
  return new DigikalaQdrantIndex(options);
}
