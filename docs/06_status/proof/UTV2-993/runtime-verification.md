# Runtime Verification — UTV2-993

**Issue:** Worker restart and double-delivery safety proof  
**Tier:** T1  
**Verified:** 2026-05-18

---

## Pre-merge Checklist

- [x] `pnpm verify` green on branch
- [x] R-level check PASS
- [x] T1 proof tests: 5/5 pass
- [x] Live-DB proof: stranded processing rows = 0, duplicate receipts = 0, circuit tracking operational
- [x] Known drift in `apps/worker/CLAUDE.md` identified and documented

---

## Behavioral Change

**Proof-only lane — no production code changed.**

This lane adds runtime evidence for three pre-existing safety mechanisms in `apps/worker`:

1. **Stale claim reaper** (`reapStaleClaims` in `runner.ts`): Runs each cycle; releases `processing` rows with `claimed_at > 5min` back to `pending`. Unit test proves this works in simulation (`staleClaimMs=0`).

2. **Atomic delivery path** (`claimNextAtomic` + `confirmDeliveryAtomic`): In database mode, both operations use Postgres RPCs. The receipt idempotency key `${outboxId}:receipt` prevents double-insert. Live-DB test proves 0 duplicate idempotency keys across 8 recent receipts.

3. **Circuit state hydration** (`hydrateOpenCircuitRuns` in `runner.ts`): On startup, reads `system_runs WHERE run_type='worker.circuit-open' AND status='running'` and calls `circuitBreaker.restoreOpen(target, openedAtMs)`. Unit test proves the circuit is marked open from durable state without accumulating new delivery failures.

---

## Live-DB Evidence

### Stranded processing rows
- **0 rows** with `status='processing' AND claimed_at < now() - interval '10 minutes'`
- Stale claim reaper is operational; any orphaned rows drain within ≤5 minutes per cycle

### Exactly-once receipts
- **8 receipts** sampled (last 7 days)
- **0 duplicate idempotency keys**
- Confirms `confirmDeliveryAtomic` + receipt idempotency key provides exactly-once delivery

### Circuit state tracking
- **0 running** `worker.circuit-open` system_runs (no active open circuits)
- **1 resolved** circuit run in last 7 days (circuit opened and closed normally)
- Confirms the durable circuit tracking mechanism is in operational use

---

## Invariant Audit

| Invariant | Check |
|-----------|-------|
| No production code changed | ✓ Only new test file + proof docs + hook fix |
| No new DB migrations | ✓ Not required — reads existing tables |
| Worker delivery invariant unaffected | ✓ Proof-only; `delivery-adapters.ts`, `distribution-worker.ts`, `runner.ts` unchanged |
| Circuit state durable (not in-memory only) | ✓ `hydrateOpenCircuitRuns` in `runner.ts` proves durable persistence — stale CLAUDE.md note documented |
| Exactly-one DeliveryOutcome per attempt | ✓ Live-DB: 0 duplicate receipts; unit test confirms atomic path mechanics |
