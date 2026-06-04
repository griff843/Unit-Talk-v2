# UTV2-1202 — Verification

## Verification

**Issue:** UTV2-1202 — both-sides fair probability guard in candidate scoring
**Tier:** T2
**Branch:** codex/utv2-1202-both-sides-fair-probability-guard

---

## Type Check

```
pnpm type-check → PASS
```

## Test Results

```
pnpm test → PASS
tests 23 (candidate-scoring-service.test.ts)
pass 23
fail 0

New tests added:
  ok 22 - UTV2-1202: skips candidate when fair_over_prob is set but fair_under_prob is null
  ok 23 - UTV2-1202: skips candidate when fair_under_prob is set but fair_over_prob is null
```

## Full Verify

```
pnpm verify → PASS (exit code 0)
tests 113 across all test suites
pass 113
fail 0
```

## R-Level Check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

## Behavioral Verification

The guard change (`&&` → `||`) correctly enforces the following invariants:

| Scenario | Before fix | After fix |
|---|---|---|
| `fair_over_prob=null`, `fair_under_prob=null` | skip | skip (unchanged) |
| `fair_over_prob=0.62`, `fair_under_prob=null` | **scored (bug)** | skip (fixed) |
| `fair_over_prob=null`, `fair_under_prob=0.58` | **scored (bug)** | skip (fixed) |
| `fair_over_prob=0.56`, `fair_under_prob=0.44` | scored | scored (unchanged) |

Unit tests 22 and 23 prove the two new cases are skipped. All 23 existing tests remain passing, confirming no regression.

---

## Scope Compliance

- `apps/api/src/promotion-service.ts`: NOT touched (UTV2-1200 owns that file)
- No DB migrations added
- No SGO activation
- No refactoring beyond the single condition fix
