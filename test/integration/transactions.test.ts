import { Mongoose, type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDigikalaMongoose,
  type DigikalaMongoose,
  type ProductDraftInput,
} from '../../src/index.js';

const replicaUri = process.env.MONGODB_REPLICA_URI;
const integration = replicaUri ? describe : describe.skip;
const databaseName = `digikala_mongoose_transaction_${process.pid}_${Date.now()}`;

const productInput = {
  key: 'transaction-product',
  details: {
    categoryId: 10707,
    brandId: 1,
    isIranian: false,
    model: 'Transaction Product',
  },
  images: [],
} satisfies ProductDraftInput;

integration('replica-set transactions', () => {
  let driver: Mongoose;
  let connection: Connection;
  let db: DigikalaMongoose;

  beforeAll(async () => {
    driver = new Mongoose();
    connection = await driver
      .createConnection(replicaUri!, {
        dbName: databaseName,
        serverSelectionTimeoutMS: 10_000,
      })
      .asPromise();
    db = createDigikalaMongoose({
      connection,
      modelPrefix: 'Transaction',
      collectionPrefix: 'transaction_',
    });
    await db.ensureReady();
  });

  afterAll(async () => {
    if (connection.readyState === 1) await connection.dropDatabase();
    await connection.close();
  });

  it('rolls back repository writes when a transaction fails', async () => {
    await expect(
      connection.transaction(async (session) => {
        const product = await db.repositories.products.create(productInput, {
          session,
        });
        await db.repositories.variants.create(
          {
            key: 'TRANSACTION-ROLLBACK-VARIANT',
            productId: product.id,
            input: {
              isActive: false,
              marketplaceSellerStock: 0,
              orderLimit: 2,
              warrantyId: 272,
              site: 'digikala',
              shippingType: 'digikala',
            },
          },
          { session },
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await db.models.ProductDraft.countDocuments()).toBe(0);
    expect(await db.models.VariantDraft.countDocuments()).toBe(0);
  });

  it('commits product, variant, and publication atomically', async () => {
    await connection.transaction(async (session) => {
      const product = await db.repositories.products.create(productInput, {
        session,
      });
      const variant = await db.repositories.variants.create(
        {
          key: 'TRANSACTION-COMMIT-VARIANT',
          productId: product.id,
          input: {
            isActive: false,
            marketplaceSellerStock: 0,
            orderLimit: 2,
            warrantyId: 272,
            site: 'digikala',
            shippingType: 'digikala',
          },
        },
        { session },
      );
      await db.repositories.publications.upsert(
        {
          panelKey: 'transaction-panel',
          productId: product.id,
          variantId: variant.id,
          status: 'queued',
        },
        { session },
      );
    });

    expect(await db.models.ProductDraft.countDocuments()).toBe(1);
    expect(await db.models.VariantDraft.countDocuments()).toBe(1);
    expect(await db.models.Publication.countDocuments()).toBe(1);
  });
});
