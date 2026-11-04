# Contributing

Thank you for contributing to `digikala-mongoose`.

## Development

```sh
npm install
npm run verify
```

Changes to public schemas or repository behavior should include tests and an
example in the README when they affect end users.

## Design rules

- Keep Digikala API contracts in the `digikala` package.
- Do not add credential or account persistence here.
- Do not open or close application-owned MongoDB connections.
- Keep NestJS and Qdrant integrations optional and isolated by package exports.
- Validate before persistence and again before generating publication payloads.
- Avoid network mutations in Mongoose middleware.

## Pull requests

Keep changes focused, explain any compatibility impact, and ensure
`npm run verify` passes on Node.js 20 or newer.
