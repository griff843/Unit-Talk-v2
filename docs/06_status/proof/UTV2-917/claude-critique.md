# Claude Critique — UTV2-917

**Issue:** UT-P0-004 Queue Freshness and Pending Age Alerting
**Branch:** codex/utv2-917-queue-freshness-alerting
**Merge SHA:** (pending merge)
**Critic:** Claude Sonnet 4.6 (orchestrator)
**Date:** 2026-05-13

---

## Invariant Correctness

This PR adds queue-truth metrics without modifying any existing delivery or lifecycle behavior. It is additive observability only.

- **`evaluateQueueHealth` is pure.** Takes queue data as input, returns a structured `QueueHealthEvaluation`. No DB calls, no side effects, no env reads. Fully testable in isolation.
- **Status escalation is deterministic.** Any alert with `level: 'critical'` → status `'down'`; warning-only alerts → `'degraded'`; no alerts → `'healthy'`. Single-pass logic with no ambiguous transitions.
- **`/health` returns 503 on degraded/down.** Heartbeat alone can no longer produce a green response when queue state is unhealthy. Correct per acceptance criteria.
- **Worker cycle metrics are additive.** `apps/worker/src/runner.ts` records gauges per cycle only when an observability provider is wired. No-op when not configured. The worker loop behavior is unchanged.
- **Target mismatch detection is correct.** Pending rows whose `target` is not in `workerTargets` are flagged as `pending-outside-worker` mismatches — directly surfacing the live condition of 6 pending rows outside worker targets.

## Threshold Assessment

- `pendingWarnMs = 30 min`: reasonable — flags rows stuck more than half an hour
- `pendingCriticalMs = 120 min`: appropriate critical threshold for a real-time pipeline
- `deliveryStaleMs = 60 min`: last successful delivery older than 1 hour → critical
- `processingStaleMs = 5 min`: in-flight processing rows stuck 5+ minutes → critical (stale claim)

The current live system (`last run: 18510m ago`, 6 pending rows outside worker targets) would immediately produce `delivery_stale` + `target_mismatch` critical alerts and status `'down'`. This is the **correct** outcome — the health check exposes real system state previously hidden behind a green heartbeat.

## Finding: pipeline-health.ts DB Integration Is Unit-Tested Only

`scripts/pipeline-health.ts` queries the live DB to evaluate queue truth. This path is not covered by `pnpm test:db` (T2 tier did not require it). The evaluator itself is thoroughly unit-tested (`packages/observability/src/index.test.ts`), but the live DB query and the script's exit-code behavior under real data are not integration-tested. Acceptable for T2 tier, but the script should be validated manually in staging before relying on its exit code in CI.

## Scope Drift

None. Changed files: `packages/observability/src/index.ts`, `packages/observability/src/index.test.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/server.ts`, `apps/api/src/server.test.ts`, `apps/worker/src/runner.ts`, `scripts/pipeline-health.ts`, and T2 proof files.

## Verdict

**APPROVE**

Pure evaluator, correct status semantics, `/health` fails loudly on queue degradation. Threshold values are appropriate for a real-time delivery pipeline. The implementation immediately surfaces the current live degradation (delivery stale + target mismatch) that was previously invisible. One finding: live-DB script integration is unit-tested only — acceptable for T2.

`pnpm verify` 113/0 pass.
