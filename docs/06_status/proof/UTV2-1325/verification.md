# UTV2-1325 — Verification

**Lane:** UTV2-1325 Grading + Model Proof Inventory  
**Branch:** `claude/utv2-1325-grading-model-proof-inventory`  
**Tier:** T2 verification  
**Date:** 2026-06-26  
**PM Authorization:** PM directive: "Start with UTV2-1325, then UTV2-1324. Goal: Model + Grading + Winning Picks Truth Package."

---

## Verification

### pnpm type-check

```
pnpm type-check
PASS — no TypeScript errors
```

Result: **PASS**

---

### pnpm lint

```
pnpm lint
PASS — no lint errors
```

Result: **PASS**

---

### pnpm build

```
pnpm build
PASS
```

Result: **PASS**

---

### pnpm test (unit tests)

```
pnpm test
# pass 113
# fail 0
```

Result: **PASS (113 unit tests, 0 failures)**

---

### pnpm test:db (live-DB smoke test)

Docs-only lane — no code changes. pnpm test:db run confirms DB health at time of lane.

```
pnpm test:db
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 33946.89267
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 17477.169568
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 15964.938071
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 17433.812369
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 814.287881
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 18205.128962
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 17563.177204
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
# duration_ms 121891.756142
```

Result: **PASS (7/7 live-DB tests, 0 failures)**

---

### R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Changed files:
  docs/06_status/readiness/GRADING_MODEL_PROOF_INVENTORY.md
  docs/06_status/proof/UTV2-1325/verification.md
  docs/06_status/proof/UTV2-1325/diff-summary.md

Rules matched: PASS — docs-only changes; no runtime, migration, or schema paths
```

Result: **PASS**

---

### Evidence Sources

This lane is a docs audit — no code changes, no DB mutation. Evidence sources:

1. **Code inspection** — `packages/db/src/runtime-repositories.ts` (9,563 lines): confirmed `InMemoryGradeResultRepository` at line 1228, `DatabaseGradeResultRepository` at line 4389, both wired in bundle at lines 8180/8212
2. **Proof artifacts read** — `docs/06_status/proof/UTV2-1251/`, `UTV2-1254/`, `UTV2-1257/`, `UTV2-1258/`, `UTV2-1042/`, `UTV2-736.md`, `PROMOTION_SCORE_AUDIT_20260511.md`
3. **State documents read** — `docs/06_status/CURRENT_STATE.md`, `docs/06_status/KNOWN_DEBT.md`, `docs/06_status/readiness/READINESS-GREEN-BASELINE-2026-06-25.md`
4. **Source files read** — `apps/api/src/grading-service.ts`, `grading-cron.ts`, `settlement-service.ts`, `clv-feedback.ts`, `real-edge-service.ts`, `packages/domain/src/models/stat-distribution.ts`, `packages/db/src/repositories.ts`

---

### Correction to Prior Agent Finding

An earlier automated agent reported `GradeResultRepository` as "BROKEN/UNPROVEN — no implementation." This was a **false finding** caused by grep encoding issues on the 9,563-line runtime-repositories.ts file. Binary search confirmed both implementations exist at lines 1228 and 4389. The inventory document reflects the corrected finding.

---

### Before/After Summary

| Dimension | Before (state of knowledge) | After (this lane) |
|---|---|---|
| GradeResultRepository status | Unknown (conflicting agent claim) | WORKING — implementations confirmed at lines 1228/4389 |
| DEBT-019 impact on scoring | Documented in KNOWN_DEBT.md | Quantified: 92.4% of edge score = confidence proxy |
| DEBT-020 impact on scoring | Documented in KNOWN_DEBT.md | Quantified: 94.4% of readiness score = constant 60 |
| P3 gate status | Known open | Confirmed: snapshot stale 2026-06-10; verdict not rendered |
| Forward-flow CLV | Known deployed | Confirmed: 0 qualifying post-deploy settlements |
| Winning-pick proof | Unknown | Confirmed: UNPROVEN — no evidence exists |

---

## Summary

| Check | Result |
|---|---|
| pnpm verify | PASS (type-check + lint + build + test) |
| pnpm type-check | PASS |
| pnpm lint | PASS |
| pnpm build | PASS |
| pnpm test (unit) | PASS (113/113) |
| pnpm test:db | PASS (7/7) |
| R-level check | PASS |
| Output artifact | `docs/06_status/readiness/GRADING_MODEL_PROOF_INVENTORY.md` |
| DB mutation | NONE |
| Certification status change | NONE |

---

## Merge SHA Binding

**Branch HEAD SHA:** `e461a4b6`  
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1083  
**Merge SHA:** `ba83018ad14ade1234ce068f6bf5cc04759e28ce`  
**Merged at:** 2026-06-26
