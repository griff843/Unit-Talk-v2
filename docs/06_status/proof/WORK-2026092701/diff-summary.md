# Diff summary: WORK-2026092701

| File | Change |
|---|---|
| `scripts/ops/pipeline-health-classification.ts` | New, pure. It resolves the deployed worker's targets (heartbeat, then explicit env, then `unknown`, with no default). It maps a target to its kill-switch key exactly as `apps/worker/src/runner.ts` does. It separates pending rows held by the kill switch and processing rows no deployed worker can claim. |
| `scripts/ops/pipeline-health-classification.test.ts` | New: 16 tests. These cover each fail-closed direction and an end-to-end run against the real `evaluateQueueHealth` on the 2026-09-26 production queue shape. One test is a mutation guard proving the removed criticals are the ones the unfiltered evaluator raises. |
| `scripts/pipeline-health.ts` | Target resolution replaces the `discord:canary` fallback. It reads `delivery_kill_switch` and excludes held and unclaimable rows from the rows `evaluateQueueHealth` judges, reporting them as named warnings. Unknown targets or an unreadable kill switch are critical and exit 1. The JSON report gains `worker_targets*`, `kill_switch_readable`, `outbox_held_by_kill_switch` and `outbox_unclaimable_processing`. |
| `package.json` | Registers the new test in `test:ops`. |
| `.ops/work/WORK-2026092701.md` | The repo-owned work order. |

Not changed: `packages/observability`, the worker, any delivery path, the monitor workflow, and any database row.

## SHA Binding

Merge SHA: pending merge
PR: pending
