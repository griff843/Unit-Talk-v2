# Verification: UTV2-1116

**Branch:** codex/utv2-1116-immutable-model-version
**HEAD SHA:** 7478c5f684eb08246da184ef6372b497f5558017
**Date:** 2026-05-27

## Summary

INIT-2.2.1 — Immutable ModelVersion with Artifact SHA. Adds `artifact_sha` column to `model_registry` via migration with a DB-level immutability trigger (`trg_model_registry_artifact_sha_immutable`). TypeScript types updated in `database.types.ts`; `repositories.ts` and `runtime-repositories.ts` wired to expose `artifact_sha` on create and through `updateStatus`. Down-script provided for schema round-trip drill. T1 live-DB proof test covers three assertions: create with sha, null default, and preservation through `updateStatus`. 113 unit tests green; 7 live-DB smoke tests green.

## Evidence

**Files changed:**
- `supabase/migrations/20260527002_utv2_1116_immutable_model_version_artifact_sha.sql` — migration adding column + immutability trigger
- `db/migrations-rollback/20260527002_utv2_1116_immutable_model_version_artifact_sha.down.sql` — rollback script
- `packages/db/src/database.types.ts` — DatabaseModelVersion type updated with artifact_sha
- `packages/db/src/repositories.ts` — ModelRegistryRepository create/read updated
- `packages/db/src/runtime-repositories.ts` — updateStatus return maps artifact_sha
- `packages/db/src/model-registry.test.ts` — unit tests for new behavior
- `apps/api/src/t1-proof-utv2-1116-artifact-sha-immutability.test.ts` — T1 live-DB proof test

**Assertions verified:**
- artifact_sha column added to model_registry via migration
- DB-level immutability trigger prevents updates to artifact_sha
- TypeScript DatabaseModelVersion type includes artifact_sha field
- repositories.ts ModelRegistryRepository exposes artifact_sha on create and read
- runtime-repositories.ts maps artifact_sha through updateStatus return value
- Down-script provided for schema round-trip drill CI check
- T1 live-DB proof test covers create/null-default/updateStatus-preservation

## Verification

### pnpm verify

Ran from worktree `/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1116-immutable-model-version`:

```
pnpm verify — PASS

> @unit-talk/v2@0.1.0 verify
> pnpm ops:sync-check && pnpm ops:system-alignment-check && pnpm ops:automation-coverage-check && pnpm env:check && pnpm lint && pnpm type-check && pnpm build && pnpm test && pnpm --filter @unit-talk/smart-form verify && pnpm verify:commands

# tests 113
# suites 13
# pass 113
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 511.460652

[check-migration-versions] 113 migration file(s) verified — no duplicate versions.
[lint-migrations] 113 migration file(s) checked — no findings.
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
# duration_ms 26269.155672
```

### R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```
