import assert from 'node:assert/strict';
import { parse } from 'yaml';

const specificationUrl =
  'https://seller.digikala.com/open-api/v1/doc/specification.yml';
const response = await fetch(specificationUrl, {
  signal: AbortSignal.timeout(20_000),
});
assert.equal(response.ok, true, `OpenAPI download returned ${response.status}`);
const specification = parse(await response.text());
const paths = specification.paths;

const operations = [
  ['get', '/open-api/v1/product-creation/attributes/{category_id}'],
  ['post', '/open-api/v1/product-creation/product/detail/validation'],
  ['post', '/open-api/v1/product-creation/attributes'],
  ['post', '/open-api/v1/product-creation/auto-title/save'],
  ['post', '/open-api/v1/product-creation/save'],
  ['post', '/open-api/v1/variants/creation/{product_id}'],
];
for (const [method, path] of operations) {
  assert.ok(
    paths?.[path]?.[method],
    `Missing OpenAPI operation ${method} ${path}`,
  );
}

function requestSchema(path, method = 'post') {
  return paths[path][method].requestBody.content['application/json'].schema;
}

function assertProperties(schema, expected, label) {
  for (const property of expected) {
    assert.ok(schema.properties?.[property], `${label} lost ${property}`);
  }
}

const details = requestSchema(
  '/open-api/v1/product-creation/product/detail/validation',
);
assert.deepEqual(
  new Set(details.required),
  new Set(['category_id', 'brand_id', 'is_iranian']),
);
assertProperties(
  details,
  [
    'category_id',
    'brand_id',
    'is_iranian',
    'package_width',
    'package_height',
    'package_length',
    'package_weight',
  ],
  'product details',
);

const attributes = requestSchema('/open-api/v1/product-creation/attributes');
assertProperties(
  attributes,
  ['draft_product_id', 'length', 'width', 'height', 'weight', 'attributes'],
  'product attributes',
);

const variant = requestSchema('/open-api/v1/variants/creation/{product_id}');
assert.deepEqual(
  new Set(variant.required),
  new Set([
    'is_active',
    'order_limit',
    'marketplace_seller_stock',
    'warranty_id',
    'site',
    'shipping_type',
  ]),
);
assertProperties(
  variant,
  [
    'supplier_code',
    'price',
    'lead_time',
    'three_hour_delivery',
    'color_id',
    'size_id',
    'package_width',
    'package_height',
    'package_length',
    'package_weight',
  ],
  'variant creation',
);

console.log('Digikala OpenAPI product and variant contracts are compatible.');
