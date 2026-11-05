# Changelog

All notable changes follow Semantic Versioning. Public exports documented in
the README are considered stable after `1.0.0`; breaking changes require a new
major version.

## Unreleased

## 1.2.0 - 2026-11-05

- Added Service Hub product moderation states and duplicate-product tracking.
- Persisted category-specific variant requirements and their fetch timestamp.
- Added pre-publication validation for lead time, package dimensions, size
  guides, main images, and one- or two-theme variants.
- Upgraded the Digikala SDK dependency to `0.5.0` and database schema to 2.

## 1.1.1 - 2026-11-04

- Restored full Mongoose 9 type and migration compatibility.
- Replaced deprecated update options with the Mongoose 8/9 API.
- Pinned kernel-compatible MongoDB and Qdrant CI service images.

## 1.1.0 - 2026-11-04

- Added full variant replacement and explicit publication update APIs.
- Made product replacement remove omitted optional fields.
- Rejected unsupported future database schema versions during startup.
- Added structured migration, index, readiness, and orchestration telemetry.
- Added cross-connection concurrency, update, migration-guard, event-redaction,
  prototype-pollution, and unsafe-pattern regression coverage.

## 1.0.1 - 2026-11-04

- Backfilled `statusHistory` for legacy publication records during migration.

## 1.0.0 - 2026-11-04

- Added real standalone MongoDB and Qdrant integration suites.
- Added race-safe publication identities and non-destructive partial updates.
- Added durable publication status history.
- Added typed duplicate, concurrency, normalization, and compatibility errors.
- Added schema versions, idempotent migrations, and `ensureReady()`.
- Added cursor pagination, archive operations, bounded bulk orchestration, and
  read-only reconciliation.
- Added observer hooks, Qdrant batching/configuration checks, clean-consumer
  package tests, coverage gates, secret scanning, provenance releases, and a
  scheduled Digikala OpenAPI drift check.

## 0.2.0 - 2026-11-04

- Added standalone-safe, resumable catalog orchestration.

## 0.1.0 - 2026-11-04

- Initial public release.
