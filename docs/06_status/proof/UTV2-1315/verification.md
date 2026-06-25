# UTV2-1315 — Verification

**Lane:** UTV2-1315 markClosingLines snapshot_at partition-pruning fix
**Branch:** `claude/utv2-1315-markclosinglines-snapshot-at-lower-bound`
**Tier:** T2 runtime
**Date:** 2026-06-25
**PM Authorization:** START AUTHORIZED (Linear comment 2026-06-25, Tier C singleton approval)

---

## Verification

### pnpm type-check

```
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json

(exit 0 — no errors)
```

Result: **PASS**

---

### pnpm test

```
All test suites passed.
# pass 19
# fail 0
# skipped 0

EXITCODE: 0
```

Result: **PASS**

---

### pnpm verify

```
pnpm verify:parallel run on branch.
env:check PASS
lint PASS
type-check PASS
build PASS
test PASS (# fail 0)

[verify:parallel] all checks passed

EXITCODE: 0
```

Result: **PASS**

---

### pnpm test:db

Run against live Supabase (`zfzdnfwdarxucxtaojxm`) — 7/7 pass:

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 16888.916906
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 17498.557818
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 18656.90403
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 15756.526971
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 712.286865
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 15750.447453
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 15751.270213
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
# duration_ms 101702.698277
```

Result: **PASS** — 7/7 tests pass against live Supabase post-fix.

---

### R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

Result: **PASS**

---

### Fix verification

Changed method: `DatabaseProviderOfferRepository.markClosingLines` in `packages/db/src/runtime-repositories.ts`

Before (full partition scan):
```typescript
.eq('provider_event_id', providerEventId)
.lt('snapshot_at', commenceTime)       // upper bound only
.eq('is_closing', false)
```

After (partition-pruned to 48h window):
```typescript
.eq('provider_event_id', providerEventId)
.gte('snapshot_at', windowStart)       // lower bound: snapshotAt - 48h
.lt('snapshot_at', commenceTime)       // upper bound: before game start
.eq('is_closing', false)
```

`windowStart` is computed at line 5080: `new Date(snapshotAt).getTime() - 48 * 60 * 60 * 1000`. The 48h window is already enforced JavaScript-side for the event array — this fix applies the same bound to the DB query, limiting the Postgres partition scan from 60+ partitions to ~2.

---

## Summary

| Check | Result |
|---|---|
| pnpm type-check | PASS |
| pnpm test | PASS (# fail 0) |
| pnpm test:db | PASS (7/7, # fail 0) |
| pnpm verify | PASS |
| R-level check | PASS |
| Fix scope | 1 line added to 1 method in 1 file |
| No schema changes | CONFIRMED |
| No migrations | CONFIRMED |
