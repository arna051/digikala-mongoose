# digikala-mongoose

**By: Hippogriff Studio**  
[https://hippogriff.ir](https://hippogriff.ir)  
**Call me:** [+989038719255](tel:+989038719255)

> **DO NOT FORGET TO DONATE!** Your support helps maintain and improve this
> open-source package.

Mongoose persistence for catalogs that must satisfy Digikala's product and
variant contracts before publication. It reuses the schemas published by
[`digikala`](https://www.npmjs.com/package/digikala), adds normalized category
rules and durable publication state, and works with plain Node.js or NestJS.

## Why this package exists

Marketplace validation should not begin after a user clicks **Publish**.
`digikala-mongoose` lets an application collect, validate, and persist
Digikala-compatible data while the product is still being edited:

```text
Your product form
  → local Zod and category validation
  → MongoDB product and variant drafts
  → per-panel publication state
  → live Digikala preflight
  → digikala SDK publication
```

The application still owns authentication, API calls, permissions, jobs, and
the canonical inventory ledger. This package owns only Digikala-ready catalog
documents and their persistence.

## Features

- Uses the official `digikala/schemas` package entry point
- Connection-scoped Mongoose models with no global connection side effects
- Product drafts, variant drafts, category rules, publication mappings, and
  resumable creation workflows
- Zod validation before database writes
- Matching Mongoose validation as a persistence safety net
- Payload builders for Digikala draft and variant creation APIs
- Per-panel remote product, draft, and variant mappings
- Optimistic concurrency and production indexes
- Transaction/session support on repository mutations
- Plain Node.js factory and optional NestJS dynamic module
- Optional Qdrant adapter with injected client and embedding provider
- ESM, CommonJS, and TypeScript declarations

## Requirements

- Node.js 20.19 or newer
- MongoDB supported by Mongoose 8 or 9
- `digikala` 0.2 or newer

## Installation

```sh
npm install digikala-mongoose mongoose
```

NestJS and Qdrant are optional. Install only what your application uses:

```sh
npm install @nestjs/common @nestjs/mongoose
npm install @qdrant/js-client-rest
```

`@qdrant/js-client-rest` is not a dependency of this package. The Qdrant
adapter accepts any structurally compatible client.

## Plain Node.js quick start

Pass an existing Mongoose connection. The package never opens or closes it:

```ts
import mongoose from 'mongoose';
import { createDigikalaMongoose } from 'digikala-mongoose';

await mongoose.connect(process.env.MONGODB_URI!);

const digikalaDb = createDigikalaMongoose({
  connection: mongoose.connection,
});

const readiness = await digikalaDb.ensureReady();
console.log(readiness.schemaVersion);
```

Create a locally validated product:

```ts
const product = await digikalaDb.repositories.products.create({
  key: 'mug-good-vibes',
  details: {
    categoryId: 10707,
    brandId: 1,
    isIranian: false,
    model: 'Good Vibes',
    packageLength: 12,
    packageWidth: 8,
    packageHeight: 10,
    packageWeight: 330,
  },
  title: {
    titleFa: 'ماگ سرامیکی مدل Good Vibes',
    description: 'ماگ سرامیکی به همراه زیرلیوانی',
  },
  images: [{ imageId: 'uploaded-image-id', isMain: true }],
});
```

Unknown fields and invalid Digikala values are rejected before MongoDB is
called.

## Category-specific validation

Digikala requirements differ by category and may change. Persist a normalized
snapshot after fetching the current requirements with the `digikala` SDK:

```ts
import { normalizeDigikalaCategoryAttributes } from 'digikala-mongoose';

const response = await digikalaClient.productCreation.getAttributes(categoryId);
const rule = normalizeDigikalaCategoryAttributes({
  categoryId,
  response,
  expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
});

await digikalaDb.repositories.categories.upsert(rule);
```

The normalizer understands Digikala's grouped attribute objects, selectable
values, required attributes, and product dimension/weight flags. Applications
can also add their own normalized form rules:

```ts
await digikalaDb.repositories.categories.upsert({
  categoryId: 10707,
  version: '2026-11-04:10707',
  title: 'ماگ',
  fetchedAt: new Date(),
  expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
  attributeRules: [],
  fields: [
    {
      path: 'title.titleFa',
      label: 'عنوان فارسی',
      type: 'string',
      required: true,
      min: 3,
    },
    {
      path: 'details.packageWeight',
      label: 'وزن بسته‌بندی',
      type: 'number',
      required: true,
      min: 1,
      max: 20_000,
    },
  ],
  sourcePayload: liveDigikalaRequirements,
});

const validation =
  await digikalaDb.repositories.products.validateForPublication(product.id);

if (!validation.valid) {
  return validation.issues; // Suitable for mapping back to form fields.
}
```

`sourcePayload` preserves fields not yet normalized by your application. It is
never treated as the validated rule set.

Local validation improves the user experience, but it does not replace a live
Digikala preflight immediately before publication.

## Product publication

After Digikala returns a remote draft product ID, build validated SDK payloads:

```ts
const payloads =
  await digikalaDb.repositories.products.buildPublicationPayloads(
    product.id,
    remoteDraftProductId,
  );

await digikalaClient.productCreation.validateDetails(payloads.details);

if (payloads.title) {
  await digikalaClient.productCreation.saveTitle(payloads.title);
}

if (payloads.attributes) {
  await digikalaClient.productCreation.validateAttributes(payloads.attributes);
}

await digikalaClient.productCreation.save(payloads.save);
```

The package builds payloads; it deliberately does not hide network mutations
inside Mongoose middleware.

## Variants

Persist a variant before a remote Digikala product exists:

```ts
const variant = await digikalaDb.repositories.variants.create({
  key: 'MUG-WHITE',
  productId: product.id,
  input: {
    isActive: false,
    marketplaceSellerStock: 0,
    orderLimit: 2,
    warrantyId: 272,
    colorId: 2,
    site: 'digikala',
    shippingType: 'digikala',
    leadTime: 1,
    packageLength: 12,
    packageWidth: 8,
    packageHeight: 10,
    packageWeight: 330,
  },
});
```

Once the product is approved, materialize the final SDK request:

```ts
const input = await digikalaDb.repositories.variants.buildPublicationPayload(
  variant.id,
  remoteProductId,
);

const created = await digikalaClient.variantCreation.create(input);
```

The local variant stores no fake remote product ID. The real ID is injected and
validated only when publishing.

## Multiple seller panels

One local product or variant can map to any number of Digikala panels:

```ts
await digikalaDb.repositories.publications.upsert({
  panelKey: 'second-heart-shop',
  productId: product.id,
  variantId: variant.id,
  remoteProductId,
  remoteVariantId: created.data.id,
  supplierCode: 'MUG-WHITE',
  status: 'published',
  synchronizedAt: new Date(),
});
```

Remote IDs are unique inside a panel, not globally. Compound indexes enforce
that distinction.

Publication documents are channel mappings, not central inventory. Stock and
reservations should remain in your marketplace-independent commerce domain.

## Resumable workflows

Persist the serializable state machine provided by `digikala`:

```ts
import {
  advanceCreationWorkflow,
  createCreationWorkflow,
} from 'digikala/schemas';

let state = createCreationWorkflow({
  vendorId: 'second-heart-shop',
  mode: 'new_product',
});

state = advanceCreationWorkflow(state, {
  type: 'details_validated',
  draftProductId: 456,
});

await digikalaDb.repositories.workflows.save(
  'second-heart-shop',
  product.id,
  state,
);
```

## NestJS

Use the existing connection managed by `@nestjs/mongoose`:

```ts
import { Module } from '@nestjs/common';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { DigikalaMongooseModule } from 'digikala-mongoose/nestjs';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    DigikalaMongooseModule.forRootAsync({
      inject: [getConnectionToken()],
      useFactory: (connection) => ({ connection }),
    }),
  ],
})
export class AppModule {}
```

Inject the complete package instance in a service:

```ts
import { Injectable } from '@nestjs/common';
import type { DigikalaMongoose } from 'digikala-mongoose';
import { InjectDigikalaMongoose } from 'digikala-mongoose/nestjs';

@Injectable()
export class CatalogService {
  constructor(
    @InjectDigikalaMongoose()
    private readonly digikalaDb: DigikalaMongoose,
  ) {}

  findByKey(key: string) {
    return this.digikalaDb.repositories.products.findByKey(key);
  }
}
```

The NestJS entry point is optional and never loaded by plain Node consumers.

## Optional Qdrant indexing

Qdrant is a derived search index. MongoDB remains authoritative.

```ts
import { QdrantClient } from '@qdrant/js-client-rest';
import { createDigikalaQdrantIndex } from 'digikala-mongoose/qdrant';

const semantic = createDigikalaQdrantIndex({
  client: new QdrantClient({ url: process.env.QDRANT_URL! }),
  embeddingProvider: myEmbeddingProvider,
  vectorSize: 384,
});

await semantic.ensureCollection();
await semantic.upsert([
  {
    id: product.id,
    text: 'ماگ سرامیکی سفید مدل Good Vibes',
    payload: { categoryId: 10707, status: 'ready' },
  },
]);

const matches = await semantic.search('ماگ سفید', { limit: 10 });
```

The embedding provider is injected:

```ts
interface DigikalaEmbeddingProvider {
  embed(texts: readonly string[]): Promise<number[][]>;
}
```

This allows Transformers.js, an external embedding API, or any future model
without coupling the persistence package to it.

Set `embeddingModel` to record the model identity in every point payload, and
use `batchSize` to bound Qdrant requests. `ensureCollection()` verifies the
existing collection's vector size and distance before indexing.

## Models and collections

| Model              | Default collection            | Purpose                               |
| ------------------ | ----------------------------- | ------------------------------------- |
| `ProductDraft`     | `digikala_products`           | Digikala-compatible product data      |
| `VariantDraft`     | `digikala_variants`           | Digikala-compatible sellable variants |
| `CategoryRule`     | `digikala_category_rules`     | Versioned dynamic validation rules    |
| `Publication`      | `digikala_publications`       | Per-panel remote mappings and status  |
| `CreationWorkflow` | `digikala_creation_workflows` | Resumable publication state           |

Customize model and collection prefixes when two installations share one
connection:

```ts
createDigikalaMongoose({
  connection,
  modelPrefix: 'StorefrontDigikala',
  collectionPrefix: 'storefront_digikala_',
});
```

## Standalone MongoDB safety

Standalone MongoDB is fully supported and does not require transactions. Use
the idempotent orchestrator when one logical operation spans a product,
variants, and panel mappings:

```ts
const result = await digikalaDb.standalone.ensureCatalog({
  product: productInput,
  variants: [
    { key: 'MUG-WHITE', input: whiteVariantInput },
    { key: 'MUG-BLACK', input: blackVariantInput },
  ],
  publications: [
    { panelKey: 'main-panel', status: 'queued' },
    {
      panelKey: 'main-panel',
      variantKey: 'MUG-WHITE',
      status: 'queued',
    },
  ],
});

console.log(result.resumed);
```

The full input is validated before the first write. Each item uses its stable
key as an idempotency identity. If the process stops after any step, call
`ensureCatalog()` again with the same input: existing matching documents are
reused and only missing steps are created.

The orchestrator deliberately preserves valid partial progress. It never
pretends that multiple standalone writes are atomic and never deletes a
product to compensate for a later failure. A reused key with different data
throws `DigikalaIdentityConflictError`; unexpected failures throw
`DigikalaStandaloneOperationError` with completed-step information in
`error.progress`.

Call `ensureReady()` before accepting orchestration work. It runs idempotent
schema migrations and creates the unique indexes that provide race-safe
idempotency.

Inspect state without writing when recovering an uncertain job:

```ts
const inspection = await digikalaDb.standalone.inspectCatalog(input);
if (inspection.repairable) {
  await digikalaDb.standalone.ensureCatalog(input);
}
```

For imports, `ensureCatalogs(inputs, { concurrency: 8 })` performs bounded
parallel work and returns one success or failure result per input. Repository
`list()` methods provide `_id` cursor pagination; product, variant, and
publication repositories also expose explicit `archive()` operations.
Publication status changes are retained in `statusHistory` for auditing.

Attach framework-neutral telemetry without exposing payloads:

```ts
createDigikalaMongoose({
  connection,
  observer: {
    onEvent(event) {
      logger.info(event, 'digikala-mongoose operation');
    },
  },
});
```

Observer failures never change persistence outcomes.

## Stable errors

| Error                                | Meaning                                      |
| ------------------------------------ | -------------------------------------------- |
| `DigikalaDuplicateIdentityError`     | A repository unique identity already exists  |
| `DigikalaConcurrencyError`           | Optimistic concurrency rejected a stale save |
| `DigikalaIdentityConflictError`      | An idempotency key points to different data  |
| `DigikalaStandaloneOperationError`   | A resumable multi-step operation was stopped |
| `DigikalaCategoryNormalizationError` | A live category response was malformed       |
| `DigikalaQdrantCompatibilityError`   | Vector collection configuration is unsafe    |

## Optional transactions

MongoDB transactions require a replica set or mongos. Repository writes accept
an optional Mongoose session for applications that have one:

```ts
await connection.transaction(async (session) => {
  await digikalaDb.repositories.categories.upsert(rule, { session });
  await digikalaDb.repositories.publications.upsert(mapping, { session });
});
```

## Production guidance

- Run `ensureReady()` during controlled startup or deployment, not on every
  request. NestJS can do this with `autoEnsureReady: true`.
- Set `autoCreateIndexes: false` when production indexes are managed separately.
- Refresh category rules and reference values regularly.
- Perform a live Digikala preflight immediately before publication.
- Do not retry uncertain product or variant creation blindly; reconcile first.
- Keep credentials, tokens, central stock, orders, and warehouse movements in
  their appropriate application domains.
- Use an outbox/job queue for API publication and synchronization.
- Never treat Qdrant payloads as current product or inventory truth.

## What this package does not do

- Manage seller credentials or authentication
- Open or close MongoDB connections
- Call Digikala APIs automatically
- Own central inventory, reservations, or orders
- Synchronize background jobs
- Bundle an embedding model or Qdrant client

Those boundaries keep the package reusable in NestJS, workers, scripts, and
other Node.js environments.

## License

MIT © Hippogriff Studio
