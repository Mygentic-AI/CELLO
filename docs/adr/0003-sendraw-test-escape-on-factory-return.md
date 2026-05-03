# ADR-0003: sendRaw / openRawStream test escapes live on the production factory return type

**Date:** 2026-05-03  
**Status:** Accepted (deferred cleanup)

## Context

`createClient()` returns `CelloClient & { sendRaw, openRawStream }` — an intersection type where test-only escape hatches are present on the return value in all environments. The safety relies on convention ("don't call these in production") rather than structure. A cast in production code could reach them.

## Decision

Leave as-is through M1. Move to a separate `createTestClient()` factory when M1 adds session management and the extended factory pattern becomes worth the setup cost.

## Rationale

- Today there is exactly one production consumer (`adapter-claude-code`), it never casts the return type, and the monorepo is internal.
- The intersection approach is simple and currently harmless.
- The right time to fix this is when M1 extends `createClient()` with session-aware tools — the refactor and the structural fix can land together rather than as two separate changes.

## Consequences

- Future code reviewers should not replicate the pattern for new test escapes.
- When M1 adds session tools to `createClient()`, the test factory separation should be done at the same time.
