# Changelog

All notable changes follow Semantic Versioning. Public exports documented in
the README are considered stable after `1.0.0`; breaking changes require a new
major version.

## Unreleased

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
