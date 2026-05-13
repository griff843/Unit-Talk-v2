---
result: pass
---

# Runtime Verification — UTV2-916

**Issue:** UT-P0-003 Fix Worker Target Drift
**Branch:** codex/utv2-916-worker-target-drift
**Verified by:** Claude (orchestrator) — 2026-05-13

---

## Runtime Checks

- [x] `evaluateDistributionTargetGate rejects enabled targets without worker coverage`: PASS
  - Test: `apps/api/src/distribution-service.test.ts`
  - Target `discord:best-bets` with only `discord:canary` in worker targets → throws `DistributionTargetMismatchError`
  - `rejectedTargetMismatchCount` increments to 1
- [x] `evaluateDistributionTargetGate allows matching coverage`: PASS
  - Test: `apps/api/src/distribution-service.test.ts`
  - Target `discord:best-bets` with `discord:best-bets` in worker targets → `ok: true`
- [x] `blocked Discord targets rejected regardless of registry config`: PASS
  - Test: `apps/api/src/distribution-service.test.ts`
  - `discord:exclusive-insights` → `enqueued: false, reason: target-disabled`; zero outbox rows written
- [x] `atomic enqueue bypass closed — drift blocks before enqueueDistributionAtomic`: PASS
  - Test: `apps/api/src/run-audit-service.test.ts`
  - `DistributionTargetMismatchError` thrown before `atomicCalled` flag set
  - No outbox rows written, pick status unchanged at `validated`
- [x] `worker startup fails closed on target mismatch in production env`: PASS
  - Test: `apps/worker/src/worker-runtime.test.ts`
- [x] `contracts target coverage report: blocked + missing targets counted correctly`: PASS
  - Test: `packages/contracts/src/promotion.test.ts`
- [x] `pnpm test:db`: PASS
  - 2/2 tests against live Supabase
  - `database repository bundle persists a submission and settlement`: PASS
  - `UTV2-883: no duplicate participants for the same external_id and sport`: PASS
- [x] `pnpm verify` (full pipeline): PASS
  - 113 tests, 0 failures, 0 cancelled

## Evidence

```
pnpm exec tsx --test apps/api/src/distribution-service.test.ts
✔ evaluateDistributionTargetGate rejects enabled promotion targets without worker coverage
✔ evaluateDistributionTargetGate allows enabled promotion targets with worker coverage
✔ enqueueDistributionWork rejects blocked promotion targets even with explicit registry

pnpm exec tsx --test apps/api/src/run-audit-service.test.ts
✔ enqueueDistributionWithRunTracking: blocks target drift before atomic enqueue

pnpm exec tsx --test apps/worker/src/worker-runtime.test.ts
✔ worker startup fails closed on target mismatch (production env)

pnpm test:db
✔ database repository bundle persists a submission and settlement (42939.9688ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (480.121ms)
tests 2 | pass 2 | fail 0

pnpm verify
tests 113 | pass 113 | fail 0
```

*Runbook: docs/05_operations/P0_PROTOCOL_SPEC.md*
