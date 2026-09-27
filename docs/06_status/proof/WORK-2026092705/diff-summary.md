# Diff summary: WORK-2026092705

| File | Change |
|---|---|
| `scripts/runtime-health.ts` | Queue Movement: exact head counts for non-sent and `sent`, a paged, id-ordered non-sent read via `readAllPages`, and evaluation delegated to `evaluateQueueMovement`. The unpaged read and the local dead-letter rule are removed. |
| `scripts/ops/runtime-health-queue.ts` | New. Pure `evaluateQueueMovement`: a partial read or unreadable count is UNKNOWN; true dead letters or pending over the critical limit are FAILED; pending over the warn limit, stuck claims, governance holds or unattempted rows are DEGRADED. |
| `scripts/ops/runtime-health-queue.test.ts` | New. 10 tests, including partial-read, parity with `bucketDeadLetterRows`, and the 2026-09-27 production shape. |
| `package.json` | Adds the new test to `test:ops`. |
| `.ops/work/WORK-2026092705.md` | Repo-owned work order. |

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1672
