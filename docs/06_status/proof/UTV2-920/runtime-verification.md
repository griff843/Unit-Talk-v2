---
result: pass
---

# Runtime Verification — UTV2-920

**Issue:** UT-P0-007 Repair DB Invariant Violations — Atomic RPC Guards
**Branch:** codex/utv2-920-db-invariant-rpc-guards
**Verified by:** Claude (orchestrator) — 2026-05-13

---

## Runtime Checks

- [x] `enqueue_distribution_atomic fails closed on state mismatch → returns null`: PASS
  - Pick not in `p_from_state` → UPDATE RETURNING yields null row → RPC returns null
  - No pick_lifecycle or distribution_outbox rows written
- [x] `enqueue_distribution_atomic succeeds when pick is in expected state`: PASS
  - Returns jsonb with pick, lifecycleEvent, outbox rows
  - Outbox idempotency_key conflict handled via ON CONFLICT DO UPDATE (no-op dedup)
- [x] `confirm_delivery_atomic raises P0001 on invalid delivery transition`: PASS
  - Outbox in wrong state (not 'sent') → returns error JSON
  - Owning pick transition fails → raises `INVALID_DELIVERY_TRANSITION P0001`
- [x] `confirm_delivery_atomic handles idempotent already-sent gracefully`: PASS
  - Outbox already 'sent' → returns `{alreadyConfirmed: true}` without re-writing
- [x] `settle_pick_atomic raises P0001 on invalid settlement transition`: PASS
  - Pick status ≠ p_lifecycle_from_state → `INVALID_SETTLEMENT_TRANSITION P0001`
  - FOR UPDATE lock prevents concurrent settlement race
- [x] `settle_pick_atomic handles duplicate settlement via unique_violation`: PASS
  - Duplicate insert caught by inline EXCEPTION block → returns `{duplicate: true}`
- [x] `recordInitialSettlement uses atomic path in Supabase mode`: PASS
  - `settlePickAtomic` called first; InMemory fallback only on `settlePickAtomic is not supported in InMemory mode` error
- [x] `pnpm verify` (full pipeline): PASS
  - 113 tests, 0 failures, 0 cancelled
- [x] `pnpm test:db` (T1 live DB requirement): PASS
  - Evidence bundle at `docs/06_status/proof/UTV2-920/evidence.json`
  - `verify.ok: true`, `verify.exitCode: 0`, pipeline `workerVerdict: HEALTHY`

## Evidence

```
pnpm verify
tests 113 | pass 113 | fail 0

evidence.json:
  verify.ok: true
  verify.exitCode: 0
  pipeline.workerVerdict: HEALTHY
  pipeline.latestRunStatus: succeeded
```

*Runbook: docs/05_operations/P0_PROTOCOL_SPEC.md*
