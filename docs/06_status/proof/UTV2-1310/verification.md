# Verification — UTV2-1310 G-CONST-15 Canonical Gap Map

## Verification

**Lane:** UTV2-1310  
**Branch:** `claude/utv2-1310-g-const-15-canonical-gap-map`  
**Tier:** T2  
**Date:** 2026-06-25  
**Merge SHA:** (pending — pre-merge)

---

## pnpm type-check

```
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json

(exit 0 — no errors)
```

**Result: PASS**

---

## pnpm test

```
> @unit-talk/v2@0.1.0 test
> pnpm test:apps && pnpm test:verification && pnpm test:domain-probability && ...

# pass 700
# fail 0
# skipped 0
# pass 20
# fail 0
# skipped 0
# pass 16
# fail 0
# skipped 0
# pass 16
# fail 0
# skipped 0
# pass 16
# fail 0
# skipped 0
# pass 14
# fail 0
# skipped 0
# pass 17
# fail 0
# skipped 0
# pass 19
# fail 0
# skipped 0

EXIT: 0
```

**Result: PASS — all suites pass, 0 failures**

---

## pnpm test:db

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 16888.44452
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 18452.772832
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 18698.998724
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 22799.727723
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 885.660422
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 19529.616667
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 17656.948367
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
# duration_ms 115690.231986

EXIT: 0
```

**Result: PASS — 7/7 DB tests pass against live Supabase**

---

## R-Level Check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff

EXIT: 0
```

**Result: PASS — no R-level artifacts required (docs-only lane)**

---

## Guardrails Confirmed

- [x] No Linear issues mutated (read-only scan)
- [x] No source code modified
- [x] No schema changes
- [x] type-check passes
- [x] All unit tests pass (700+ assertions)
- [x] All DB smoke tests pass (7/7 against live Supabase)
- [x] R-level check passes
- [x] Lane is docs-only — no Tier C path touches
- [x] Output files written to correct paths under `docs/06_status/`
