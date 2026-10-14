# Diff summary: WORK-2026101303

| File | Change |
|---|---|
| `packages/db/src/repositories.ts` | Adds an optional `PickRepository.listTrackOnlyByLifecycleState?(lifecycleState)` so narrow repository fakes stay source-compatible; callers fall back to the paged reader. |
| `packages/db/src/runtime-repositories.ts` | `DatabasePickRepository.listTrackOnlyByLifecycleState` pages through `readAllOrderedPages` with `.eq('status', state)` and `.eq('metadata->>distributionMode', 'track-only')`, ordered `created_at, id`. `listByLifecycleState` and every other method are untouched. |
| `apps/api/src/grading-service.ts` | `executeGradingPass` reads `validated` picks through the new method when the repository provides it, otherwise through the existing `fetchAllByLifecycleState`. The `posted` and `awaiting_approval` reads are unchanged. The in-JS `isEvidencePlanePick` filter stays as a backstop, so the narrowed read can only remove candidates. |
| `apps/api/src/grading-service.test.ts` | Two tests: a mixed validated set (Track Only, delivery-eligible, no mode) proves the filtered read yields the same graded population with `restrictToPickIds` and `rowsScanned` semantics unchanged; a second proves the fallback path for a repository without the new method. |
| `.ops/work/WORK-2026101303.md` | Repo-owned work order. |

Lane, sync and proof metadata accompany these paths. No migration, index, fixture deletion, timeout change, proof weakening, settlement, delivery, deploy, or Discord change.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1754
Execution SHA: bc679de4e3dfc46cb1a78ebbc6aa3ce83b758313
