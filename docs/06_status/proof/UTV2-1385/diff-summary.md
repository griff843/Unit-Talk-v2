# UTV2-1385 Diff Summary

## Summary

- Added `scripts/ci/check-promotion-target-sync.ts`, a fail-closed CI guard for DEBT-017.
- The guard reads the canonical `promotionTargets` array from `packages/contracts/src/promotion.ts`.
- The guard scans SQL migrations for `picks_promotion_target_check` and fails if any definition is missing or out of sync with the canonical target list.

## Files Changed

- `scripts/ci/check-promotion-target-sync.ts` - extracts promotion target values from the contract registry and migration constraint definitions, compares them in order, prints a PASS/FAIL summary, and exits nonzero on drift.

## Scope Notes

- No contracts, domain logic, migrations, DB repository code, worker code, or runtime routing behavior changed.
- Proof files added under `docs/06_status/proof/UTV2-1385/` because they are explicitly required by the lane packet.
