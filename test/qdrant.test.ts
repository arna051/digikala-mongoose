import { describe, expect, it, vi } from 'vitest';
import {
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
});
