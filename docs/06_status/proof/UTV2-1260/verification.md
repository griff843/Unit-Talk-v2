# UTV2-1260 — Proof

**Branch:** `claude/utv2-1260-grading-cron-failure-investigation`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1014
**Merge SHA:** `cfd9d2c0`
**Tier:** T2

## Summary

Root cause: `grading-service.ts` threw `Error` for `game_result_actual_value_invalid` (null/non-finite `actual_value` in `game_results`). This throw caused the whole grading run to record `run_status='failed'`, preventing downstream processing of other picks.

Fix: changed throw → skip. Picks with non-finite actual_value now record `outcome='skipped'` with an explicit reason string. The grading run completes as `succeeded`, and the skip is recorded in `details[].reason` for ops visibility.

## Evidence

### pnpm test (unit tests)

```
1..61
# tests 61
# suites 0
# pass 61
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 985.292548
```

### pnpm test:db

```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 146535.279136
```

## Verification

- `pnpm verify` green on branch (lint + pnpm type-check + build + pnpm test)
- All 61 unit tests pass via `pnpm test`, 0 fail
- All 7 DB tests pass via `pnpm test:db`, 0 fail — DB integrity preserved
- `scripts/ci/r-level-check.ts` R-level compliance: no R2/R3 artifacts triggered (no schema/migration changes)
- Test 55 (`runGradingPass records error when game result actual_value is NaN`) updated to assert:
  - `outcome: 'skipped'` (was: `'error'`)
  - `errors: 0` (was: `1`)
  - `skipped: 1` (new assertion)
  - `reason` contains `'game_result_actual_value_invalid'` (unchanged)
- Scope confined to `apps/api/src/grading-service.ts` and `apps/api/src/grading-service.test.ts`
- No schema changes, no migration changes, no new dependencies
- PM instructions compliance: audit detail preserved, no fabricated results, no silent degradation
- Merge SHA: `cfd9d2c0`
