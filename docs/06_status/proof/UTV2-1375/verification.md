# UTV2-1375 Verification

## Verification

### pnpm type-check
Passed as part of `pnpm verify:static` run by Codex during implementation.

### pnpm test
All unit tests passed including `scripts/ops/preflight.test.ts` and all existing ops test files.

Test suites exercised:
- `test:apps` — passed
- `test:verification` — passed
- `test:domain-*` (all domain packages) — passed
- `test:ops` — passed (includes `preflight.test.ts`, `shared.test.ts`, and 60+ other ops tests)
- `test:t1-proof:local` — passed

### pnpm test:db

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 17615.145693
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 15238.483534
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 20960.277165
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 22636.037733
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 5182.671592
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 20922.123241
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 17975.234342
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 121317.352249
```

### Issue-specific verification
The `runGateEquivalentChecks` function:
- PX1 invokes `pnpm verify:quick` and surfaces failures directly in the preflight output
- PX2 invokes `pnpm ops:branch-discipline` for early cross-reference detection
- PX3/PX4 are proof-gate checks gated on proof dir existence (skip when no proof dir present)
- PX5 is a T1-only proof dir presence check

All existing preflight tests continue to pass — the new checks are additive only. The `fastBaselineAllowed` function, `isLaneRegistryPath` function, and `readConfiguredEnvValue` usage are all still present as expected by the test assertions.

### R-level check
R1–R5 checks: governance lane, no new packages, no DB schema changes, no migration added, no T1 runtime path touched.

## Merge SHA

Merged to main: `8cfe5a1deb7a983b861e41e1ff9a80881bc04eb9`
