import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DigikalaQdrantCompatibilityError,
  createDigikalaQdrantIndex,
  type QdrantClientLike,
} from '../../src/qdrant/index.js';

const qdrantUrl = process.env.QDRANT_URL;
const integration = qdrantUrl ? describe : describe.skip;
const collectionName = `digikala_mongoose_integration_${process.pid}_${Date.now()}`;

function httpError(path: string, status: number): Error & { status: number } {
  return Object.assign(new Error(`Qdrant ${path} returned HTTP ${status}`), {
    status,
  });
}

async function request(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const response = await fetch(`${qdrantUrl}${path}`, {
    method: options.method ?? 'GET',
    headers:
      options.body === undefined
        ? undefined
        : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) throw httpError(path, response.status);
  return ((await response.json()) as { result: unknown }).result;
}

const client: QdrantClientLike = {
  getCollection: (name) => request(`/collections/${name}`),
  createCollection: (name, options) =>
    request(`/collections/${name}`, { method: 'PUT', body: options }),
  upsert: (name, options) =>
    request(`/collections/${name}/points?wait=${options.wait ?? true}`, {
      method: 'PUT',
      body: { points: options.points },
    }),
  delete: (name, options) =>
    request(`/collections/${name}/points/delete?wait=${options.wait ?? true}`, {
      method: 'POST',
      body: { points: options.points },
    }),
  search: (name, options) =>
    request(`/collections/${name}/points/search`, {
      method: 'POST',
      body: options,
    }) as ReturnType<QdrantClientLike['search']>,
  retrieve: (name, options) =>
    request(`/collections/${name}/points`, {
      method: 'POST',
      body: options,
    }) as ReturnType<NonNullable<QdrantClientLike['retrieve']>>,
};

integration('Qdrant integration', () => {
  const index = createDigikalaQdrantIndex({
    client,
    collectionName,
    vectorSize: 3,
    batchSize: 2,
    embeddingModel: 'integration-model@1',
    embeddingProvider: {
      embed: (texts) =>
        Promise.resolve(
          texts.map((text) => (text.includes('mug') ? [1, 0, 0] : [0, 1, 0])),
        ),
    },
  });

  beforeAll(() => index.ensureCollection());

  afterAll(async () => {
    await fetch(`${qdrantUrl}/collections/${collectionName}`, {
      method: 'DELETE',
    });
  });

  it('stores, searches, and removes real points', async () => {
    await index.upsert([
      { id: '1', text: 'white mug' },
      { id: '2', text: 'black perfume' },
      { id: '3', text: 'ceramic mug' },
    ]);

    const matches = await index.search('mug', { limit: 3 });
    expect(matches[0]?.payload).toMatchObject({
      mongoId: expect.any(String),
      _digikalaEmbeddingModel: 'integration-model@1',
    });

    await index.remove(['1']);
    const afterRemoval = await index.search('mug', { limit: 3 });
    expect(afterRemoval.some((item) => item.payload?.mongoId === '1')).toBe(
      false,
    );
  });

  it('rejects a conflicting vector configuration', async () => {
    const incompatible = createDigikalaQdrantIndex({
      client,
      collectionName,
      vectorSize: 4,
      embeddingProvider: { embed: () => Promise.resolve([[1, 0, 0, 0]]) },
    });

    await expect(incompatible.ensureCollection()).rejects.toBeInstanceOf(
      DigikalaQdrantCompatibilityError,
    );
  });
});
