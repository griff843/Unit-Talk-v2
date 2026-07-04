# UTV2-1421 Diff Summary

## Summary

- Changed `scripts/ops/lane-finalize.ts` so the `apply_tier_label` step is required when the lane manifest has an authoritative tier.
- Updated `scripts/ops/lane-finalize.test.ts` to assert that a `gh pr edit --add-label tier:<tier>` failure aborts lane finalization before proof generation or lane closeout.

## Files Changed

- `scripts/ops/lane-finalize.ts` — makes tier label application fail closed.
- `scripts/ops/lane-finalize.test.ts` — replaces the previous non-blocking tier label failure expectation with the fail-closed behavior.

## Scope

No runtime, migration, domain, contract, DB repository, worker, or delivery files were changed.
