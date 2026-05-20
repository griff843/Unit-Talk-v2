# UTV2-1018 Diff Summary — Fix promotion eval outside atomic block

## Issue

`evaluateAllPoliciesEagerAndPersist` was called outside the atomic try/catch block in `submission-service.ts`. A throw from this function left the pick persisted in the database (in `validated` state) with `promotion_target = null` and no audit trace — a "stranded pick" with no recovery path.

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/submission-service.ts` | Wrapped `evaluateAllPoliciesEagerAndPersist` in try/catch; logs structured error + writes `promotion_eval_failed` audit record, then rethrows |
| `apps/api/src/stranded-pick-reconciler.ts` | New: `detectStrandedPicks()` + `auditStrandedPicks()` for periodic reconciliation |
| `apps/api/src/t1-proof-utv2-1018-stranded-picks.test.ts` | New: T1 live-DB proof (4 tests, all pass) |
| `apps/api/package.json` | Added `test:t1-proof:1018` script |

## Live Evidence

`detectStrandedPicks()` found **196 stranded picks** in the live database on first run, confirming the bug existed before this fix. All 4 T1 proof tests passed.

## Acceptance Criteria

- [x] Promotion eval failures are observable (structured log + audit record)
- [x] `detectStrandedPicks()` correctly identifies picks in `validated` state older than threshold with null `promotion_target`
- [x] `auditStrandedPicks()` writes audit records with actor `stranded-pick-reconciler`
- [x] `picks.promotion_target` column exists (schema invariant verified)
- [x] `pnpm verify` green
- [x] T1 proof 4/4 PASS against live Supabase

Branch HEAD SHA: e8b67dd3869a5a826c60c4c050bb59157308998d

Merge SHA: 50b0c9e6dcc20d709dfa13d97460c1461d1c399d
