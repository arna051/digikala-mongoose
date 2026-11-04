import { describe, expect, it, vi } from 'vitest';
import {
  DigikalaQdrantCompatibilityError,
  createDigikalaQdrantIndex,
  qdrantPointId,
  type QdrantClientLike,
} from '../src/qdrant/index.js';

function setup() {
  const client: QdrantClientLike = {
    getCollection: vi.fn(() => Promise.reject({ status: 404 })),
    createCollection: vi.fn(() => Promise.resolve({})),
    upsert: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
    search: vi.fn(() =>
      Promise.resolve([{ id: qdrantPointId('mongo-1'), score: 0.9 }]),
    ),
  };
  const index = createDigikalaQdrantIndex({
    client,
    vectorSize: 3,
    embeddingProvider: {
      embed: (texts) => Promise.resolve(texts.map(() => [0.1, 0.2, 0.3])),
    },
  });
  return { client, index };
}

describe('optional Qdrant adapter', () => {
  it('creates the collection and indexes Mongo ids as deterministic UUIDs', async () => {
    const { client, index } = setup();
    await index.ensureCollection();
    await index.upsert([
      { id: 'mongo-1', text: 'ماگ سرامیکی', payload: { categoryId: 10707 } },
    ]);

    expect(client.createCollection).toHaveBeenCalledWith('digikala_products', {
      vectors: { size: 3, distance: 'Cosine' },
    });
    expect(client.upsert).toHaveBeenCalledWith(
      'digikala_products',
      expect.objectContaining({
        points: [
          expect.objectContaining({
            id: qdrantPointId('mongo-1'),
            payload: { categoryId: 10707, mongoId: 'mongo-1' },
          }),
        ],
      }),
    );
  });

  it('embeds semantic queries without requiring a Qdrant package dependency', async () => {
    const { client, index } = setup();
    const result = await index.search('ماگ سفید', { limit: 5 });
    expect(result[0]?.score).toBe(0.9);
    expect(client.search).toHaveBeenCalledWith(
      'digikala_products',
      expect.objectContaining({ limit: 5, vector: [0.1, 0.2, 0.3] }),
    );
  });

  it('verifies existing collection dimensions and distance', async () => {
    const { client, index } = setup();
    client.getCollection = vi.fn(() =>
      Promise.resolve({
        config: { params: { vectors: { size: 4, distance: 'Cosine' } } },
      }),
    );

    await expect(index.ensureCollection()).rejects.toBeInstanceOf(
      DigikalaQdrantCompatibilityError,
    );
    expect(client.createCollection).not.toHaveBeenCalled();

    client.getCollection = vi.fn(() =>
      Promise.resolve({
        config: { params: { vectors: { size: 3, distance: 'Dot' } } },
      }),
    );
    await expect(index.ensureCollection()).rejects.toThrow(
      'expected Cosine distance but found Dot',
    );
  });

  it('batches large upserts and records the embedding model', async () => {
    const client: QdrantClientLike = {
      getCollection: vi.fn(() => Promise.reject({ status: 404 })),
      createCollection: vi.fn(() => Promise.resolve({})),
      upsert: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      search: vi.fn(() => Promise.resolve([])),
    };
    const index = createDigikalaQdrantIndex({
      client,
      vectorSize: 1,
      batchSize: 2,
      embeddingModel: 'test-model@1',
      embeddingProvider: {
        embed: (texts) => Promise.resolve(texts.map(() => [1])),
      },
    });

    await index.upsert(
      Array.from({ length: 5 }, (_, id) => ({
        id: String(id),
        text: `product ${id}`,
      })),
    );

    expect(client.upsert).toHaveBeenCalledTimes(3);
    expect(client.upsert).toHaveBeenNthCalledWith(
      1,
      'digikala_products',
      expect.objectContaining({
        points: expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              _digikalaEmbeddingModel: 'test-model@1',
            }),
          }),
        ]),
      }),
    );
  });

  it('rejects unsafe search limits before embedding', async () => {
    const { index } = setup();
    await expect(index.search('query', { limit: 0 })).rejects.toThrow(
      'between 1 and 1000',
    );
  });

  it('accepts a compatible existing collection', async () => {
    const { client, index } = setup();
    client.getCollection = vi.fn(() =>
      Promise.resolve({
        result: {
          config: { params: { vectors: { size: 3, distance: 'Cosine' } } },
        },
      }),
    );
    await expect(index.ensureCollection()).resolves.toBeUndefined();
  });

  it('validates configuration and embedding output', async () => {
    const { client } = setup();
    expect(() =>
      createDigikalaQdrantIndex({
        client,
        vectorSize: 3,
        collectionName: ' ',
        embeddingProvider: { embed: () => Promise.resolve([]) },
      }),
    ).toThrow('collectionName');
    expect(() =>
      createDigikalaQdrantIndex({
        client,
        vectorSize: 3,
        batchSize: 0,
        embeddingProvider: { embed: () => Promise.resolve([]) },
      }),
    ).toThrow('batchSize');

    const wrongCount = createDigikalaQdrantIndex({
      client,
      vectorSize: 3,
      embeddingProvider: { embed: () => Promise.resolve([]) },
    });
    await expect(wrongCount.upsert([{ id: '1', text: 'one' }])).rejects.toThrow(
      'different number',
    );

    const wrongDimension = createDigikalaQdrantIndex({
      client,
      vectorSize: 3,
      embeddingProvider: { embed: () => Promise.resolve([[1, 2]]) },
    });
    await expect(
      wrongDimension.upsert([{ id: '1', text: 'one' }]),
    ).rejects.toThrow('does not match');
    await expect(wrongDimension.remove([])).resolves.toBeUndefined();
  });

  it('pins an embedding model and rejects model mixing', async () => {
    const { client } = setup();
    client.getCollection = vi.fn(() =>
      Promise.resolve({
        config: { params: { vectors: { size: 3, distance: 'Cosine' } } },
      }),
    );
    client.retrieve = vi.fn(() =>
      Promise.resolve([
        {
          id: 'config',
          payload: { _digikalaEmbeddingModel: 'old-model' },
        },
      ]),
    );
    const index = createDigikalaQdrantIndex({
      client,
      vectorSize: 3,
      embeddingModel: 'new-model',
      embeddingProvider: { embed: () => Promise.resolve([[1, 0, 0]]) },
    });

    await expect(index.ensureCollection()).rejects.toThrow(
      'expected embedding model new-model',
    );
  });
});
