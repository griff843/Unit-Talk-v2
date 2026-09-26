# Diff summary: WORK-2026092602

Base `0a6690bc6`, code commit `fc0634c5b2e3dd53c54cbdaaba35b79eb26fe837`. 4 files, +547 / -2.

| File | Change |
|---|---|
| `scripts/ci/staging-board-drain.ts` | New. Signature matcher, pure selector with hard exclusions, and a paged drain that voids through `transition_pick_lifecycle`. |
| `scripts/ci/seed-staging-fixtures.ts` | Runs the drain after the reference upserts, logs the count, and fails the job on error. |
| `apps/api/src/t1-proof-atomicity.test.ts` | `after()` voids the STEP 3 enqueue pick so the suite leaves nothing on the board. |
| `scripts/ci/staging-path-enforcement.test.ts` | 7 selection tests, covering both inclusion and exclusion. |

No migration, no schema change, no package.json edit, and no production path.

## SHA Binding

Merge SHA: e019642a8176a51397ea85768c6e8e0b7c293469
PR: https://github.com/griff843/Unit-Talk-v2/pull/1655
Execution SHA: fc0634c5b2e3dd53c54cbdaaba35b79eb26fe837
