import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = await import('digikala-mongoose');
const nestjs = await import('digikala-mongoose/nestjs');
const qdrant = await import('digikala-mongoose/qdrant');

assert.equal(typeof root.createDigikalaMongoose, 'function');
assert.equal(typeof root.createDigikalaStandaloneOrchestrator, 'function');
assert.equal(typeof root.ProductDraftInputSchema.safeParse, 'function');
assert.equal(typeof root.VariantCreateInputSchema.safeParse, 'function');
assert.equal(typeof nestjs.DigikalaMongooseModule.forRootAsync, 'function');
assert.equal(typeof qdrant.createDigikalaQdrantIndex, 'function');

const cjsRoot = require('digikala-mongoose');
const cjsQdrant = require('digikala-mongoose/qdrant');
assert.equal(typeof cjsRoot.createDigikalaMongoose, 'function');
assert.equal(typeof cjsQdrant.qdrantPointId, 'function');

console.log('ESM and CommonJS package exports are valid.');
