# UTV2-1260 — Diff Summary

**Branch:** `claude/utv2-1260-grading-cron-failure-investigation`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1016
**Merge SHA:** `e3df54fc770cc1f9b0fd7439438c4e1ca8762164`
**Tier:** T2

## Change Summary

**Root cause:** `grading-service.ts` line 267–271 threw `Error` when `game_result_actual_value_invalid` (null/non-finite `actual_value` in `game_results`). This throw propagated to the catch block at line 341, which recorded `outcome: 'error'`, but also caused `run_status = 'failed'` for the whole grading batch — preventing downstream processing.

**Fix:** Changed throw → skip. The pick now gets `outcome: 'skipped'` with a full audit reason string containing the skip category code and the raw value for ops visibility. `run_status` becomes `'succeeded'` for the run, and the skip is still counted in `details.failed` for monitoring.

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/grading-service.ts` | throw → skip with `outcome='skipped'` and explicit reason |
| `apps/api/src/grading-service.test.ts` | Updated test 55 to assert skipped behavior (errors=0, skipped=1, outcome='skipped') |

## Invariant Compliance

- Fail-closed preserved: picks are explicitly recorded as skipped with reason — no silent pass-through
- Audit detail preserved: `reason` string includes `actual_value` and `result.id` for per-pick diagnosis
- No fabrication: picks remain ungraded (not assigned a win/loss outcome)
- No scope bleed: changes confined to `apps/api/src/grading-service.ts` and its test

