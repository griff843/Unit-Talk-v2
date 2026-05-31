# Diff Summary — UTV2-1142 INIT-4.4.2 — Reproducible Performance Cohorts

## Changes

**New module:** `packages/domain/src/cohorts/performance-cohort.ts`
- `CohortWindow`, `CohortInput`, `PerformanceCohort`, `BuildCohortResult` types
- `buildPerformanceCohort(input)` — deterministic cohort construction
- `reconstructCohort(stored)` — replay-safe reconstruction
- `validateCohortInput(input)` — fail-closed validation

**New tests:** `packages/domain/src/cohorts/performance-cohort.test.ts`
- 22 tests covering validation, construction, determinism, reconstruction, attribution compatibility

**New barrel:** `packages/domain/src/cohorts/index.ts`
- Re-exports all from `performance-cohort.ts`

**Modified:** `packages/domain/src/index.ts`
- Added `export * from './cohorts/index.js'`

## Scope

Pure domain computation. No DB access, no HTTP, no env reads.
Depends on `attribution-engine.ts` (UTV2-1141 — already on main).
