# Diff summary: UTV2-1959

The substantive change is limited to the sanctioned missing-token recovery and
its focused `node:test` regression.

| File | Change |
|---|---|
| `scripts/ops/lane-link-pr.ts` | Copies the validated active T1 manifest's `t1_live_db_precondition` into the reconstructed preflight token at the final write step, after all existing ownership, PR-head, dependency, cleanliness, and scope-lock checks pass. |
| `scripts/ops/lane-link-pr.test.ts` | Proves recovery preserves `deferred_to_ci` when the manifest carries it and omits the field during ordinary recovery when the manifest does not. Existing fail-closed recovery coverage remains intact. |

Lane manifest, sync metadata, and this proof directory are lane-lifecycle
artifacts. No warehouse, runtime, database, or live-DB waiver behavior changes.

## SHA Binding

- Verified source SHA: `5072855a4387ae7e82a0be610a7c3319d96371cd`
- Merge SHA: pending merge
- PR: https://github.com/griff843/Unit-Talk-v2/pull/1700
