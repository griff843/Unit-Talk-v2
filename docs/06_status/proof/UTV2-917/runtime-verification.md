---
result: pass
---

# Runtime Verification — UTV2-917

**Issue:** UT-P0-004 Queue Freshness and Pending Age Alerting
**Branch:** codex/utv2-917-queue-freshness-alerting
**Verified by:** Claude (orchestrator) — 2026-05-13

---

## Runtime Checks

- [x] `evaluateQueueHealth: stale pending rows → pending_stale critical, status down`: PASS
  - Test: `packages/observability/src/index.test.ts`
  - Row older than `pendingCriticalMs` → `pending_stale` critical alert, status `'down'`
- [x] `evaluateQueueHealth: warn-level pending → status degraded`: PASS
  - Test: `packages/observability/src/index.test.ts`
  - Row older than `pendingWarnMs` but under `pendingCriticalMs` → `'degraded'`
- [x] `evaluateQueueHealth: dead-letter rows → critical alert`: PASS
  - Test: `packages/observability/src/index.test.ts`
  - `dead_letter` rows present → `dead_letter` critical alert, status `'down'`
- [x] `evaluateQueueHealth: empty queue is healthy`: PASS
  - Test: `packages/observability/src/index.test.ts`
  - No rows → status `'healthy'`, zero alerts
- [x] `evaluateQueueHealth: pending row outside workerTargets → target_mismatch critical`: PASS
  - Test: `packages/observability/src/index.test.ts`
  - Pending row with target not in workerTargets → `target_mismatch` critical alert
- [x] `evaluateQueueHealth: pending work + no delivery timestamp → delivery_missing critical`: PASS
  - Test: `packages/observability/src/index.test.ts`
- [x] `/health returns 503 when queue is degraded (pending without delivery truth)`: PASS
  - Test: `apps/api/src/server.test.ts`
  - Pending outbox rows without delivery truth → 503 response with queue alerts
- [x] `pnpm verify` (full pipeline): PASS
  - 113 tests, 0 failures, 0 cancelled

## Evidence

```
pnpm exec tsx --test packages/observability/src/index.test.ts
All queue health evaluator scenarios pass:
✔ stale pending rows produce critical alert
✔ warning-level stale pending produces degraded status
✔ dead-letter rows produce critical alert
✔ empty queue is healthy
✔ target mismatch produces critical alert
✔ pending work without delivery timestamp → delivery_missing critical
✔ metric output reflects evaluation state

pnpm exec tsx --test apps/api/src/server.test.ts
✔ /health fails when pending work exists without delivery truth (503)

pnpm verify
tests 113 | pass 113 | fail 0
```

Note: `pnpm test:db` not required for T2 — no migrations, DB package changes, or service-layer files modified. Live-DB integration of `scripts/pipeline-health.ts` is covered by the unit-tested evaluator.

*Runbook: docs/05_operations/P0_PROTOCOL_SPEC.md*
