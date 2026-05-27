# Verification: UTV2-1112

**Branch:** claude/utv2-1112-feature-vector-entity
**HEAD SHA:** 9c4f2e6ef98efc4f8f580fc4afac2b0aeeb9f621
**Date:** 2026-05-27

## Summary

INIT-3.1.1 — FeatureVector Entity and Schema Registry. Adds a pure-domain `FeatureVector` entity with an append-only `FeatureVectorSchemaRegistry`, a fail-closed `createFeatureVector` factory, and deterministic SHA-256 hashing. All logic is stateless with no I/O, no DB, no env reads. 11 unit tests pass; all existing suite tests (113) remain green; 7 live-DB smoke tests pass.

## Evidence

**Files changed:**
- `packages/domain/src/models/feature-vector.ts` — FeatureVector entity, registry, factory
- `packages/domain/src/models/feature-vector.test.ts` — 11 node:test unit tests
- `packages/domain/src/models/index.ts` — re-export added

**Assertions verified:**
- FeatureVectorSchema is immutable after registration (duplicate key throws)
- createFeatureVector fails closed on unknown schema
- createFeatureVector fails closed on missing required fields
- Hash is deterministic: same schema + fields → identical SHA-256
- Hash differs for different field values or schema versions
- Extra undeclared input fields are dropped (no data leakage)
- Domain package remains pure: no I/O, no DB, no env reads

## Verification

### pnpm verify

Ran from worktree `/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1112-feature-vector-entity`:

```
pnpm verify — PASS

> @unit-talk/v2@0.1.0 verify
> env:check && pnpm --filter '@unit-talk/*' --filter '!@unit-talk/discord-bot' build && pnpm lint && pnpm type-check && pnpm test && pnpm verify:commands

# tests 113
# suites 13
# pass 113
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 692.690113

[check-migration-versions] 112 migration file(s) verified — no duplicate versions.
[lint-migrations] 112 migration file(s) checked — no findings.
```

### pnpm test:db

```
pnpm test:db — PASS (7/7 live Supabase tests)

1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 32490.5281
```

### Feature vector tests (11/11)

```
pnpm tsx --test packages/domain/src/models/feature-vector.test.ts

# tests 11
# suites 0
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 366.781991
```
