# Verification — UTV2-1142 INIT-4.4.2 — Reproducible Performance Cohorts

## Verification

Branch: `claude/utv2-1142-init-442-reproducible-performance-cohorts`
Branch HEAD SHA: `d368e8c0dc53796ce4b5dd115981b34bde07b358`

### pnpm verify

```
PASS — 628 tests, 0 failures
```

Stages: sync-check ✓, system-alignment ✓, automation-coverage ✓, env:check ✓,
lint ✓, type-check ✓, build ✓, test ✓, smart-form ✓, verify:commands ✓

### pnpm test:db

```
PASS — 7 tests, 0 failures (164102ms)
Tests: settlement immutability, correction chain, dual-auth enforcement
```

### Cohort unit tests (22 tests)

```
PASS — 22/22
```

Coverage: validation (7), construction (12), reconstruction (2), attribution compatibility (1)

### R-level check

```
PASS — no R-level artifacts required for this diff
Changed files: packages/domain/src/cohorts/, packages/domain/src/index.ts
```

## Invariants

- `buildPerformanceCohort` is deterministic: same `CohortInput` → same `PerformanceCohort`
- `reconstructCohort` matches original build exactly (replay-safe from stored inputs)
- Fail-closed on: missing cohort_id, invalid window bounds, empty picks, duplicate pick_ids
- Window membership enforced: `settled_at` outside window → rejected
- Attribution compatibility confirmed: cohort decomposition matches attribution-engine
