# UTV2-1312 — Verification

**Lane:** UTV2-1312 G-CONST-17 Outbox Classification Audit  
**Branch:** `claude/utv2-1312-g-const-17-outbox-classification-audit`  
**Tier:** T3 (read-only proof lane)  
**Date:** 2026-06-25  
**Merge SHA:** (pending — pre-merge)

---

## pnpm type-check

```
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json

(exit 0 — no errors)
```

Result: **PASS**

---

## pnpm test

```
> @unit-talk/v2@0.1.0 test

All test suites passed. Summary across all suites:
# fail 0
# skipped 0
(all pass lines: 4, 62, 2, 16, 91, 3, 20, 16, 16, 16, 14, 17, 19 ... # fail 0 across all)

EXITCODE: 0
```

Result: **PASS** — all unit tests green, # fail 0 across all suites

---

## pnpm test:db

```
> @unit-talk/v2@0.1.0 test:db
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 17087.253321
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 20321.290262
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 35885.588444
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 16150.635959
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 798.578306
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 18119.047602
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 15297.675899
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
# duration_ms 125889.891773

EXITCODE: 0
```

Result: **PASS** — 7/7 tests pass against live Supabase (`zfzdnfwdarxucxtaojxm`)

---

## R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

Result: **PASS**

---

## Guardrails

- **No DELETE performed:** CONFIRMED
- **No UPDATE performed:** CONFIRMED
- **No DDL performed:** CONFIRMED
- **No INSERT performed:** CONFIRMED
- All SQL was SELECT-only read queries against `distribution_outbox`
- Table name discrepancy noted: spec referenced `outbox`, actual table is `distribution_outbox`; no mutations of any kind were attempted

---

## Summary

| Check | Result |
|---|---|
| pnpm type-check | PASS |
| pnpm test | PASS (# fail 0) |
| pnpm test:db | PASS (7/7, # fail 0) |
| R-level check | PASS |
| No mutations | CONFIRMED |
