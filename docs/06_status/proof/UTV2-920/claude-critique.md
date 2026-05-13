# Claude Critique — UTV2-920

**Issue:** UT-P0-007 Repair DB Invariant Violations — Atomic RPC Guards
**Branch:** codex/utv2-920-db-invariant-rpc-guards
**Merge SHA:** (pending merge)
**Critic:** Claude Sonnet 4.6 (orchestrator)
**Date:** 2026-05-13

---

## Invariant Correctness

This PR adds three `CREATE OR REPLACE FUNCTION` migrations that enforce fail-closed semantics on pick lifecycle transitions at the Postgres level, closing the gap where application-layer race conditions or bugs could write lifecycle events or outbox rows even when the owning pick was not in the expected state.

### `enqueue_distribution_atomic`

Updates `picks.status` from `p_from_state` → `p_to_state` and inserts `pick_lifecycle` and `distribution_outbox` rows only when the owning pick is in the expected state.

**Correctness:** `RETURNING * INTO v_pick_row; IF v_pick_row.id IS NULL THEN RETURN NULL;` — correct conditional return. All three dependent writes happen within the same transaction only after the owning pick transition is confirmed. Outbox insert uses `ON CONFLICT (idempotency_key)` deduplication.

**Finding 1 — Soft fail vs hard fail inconsistency:** `enqueue_distribution_atomic` returns `null` on state mismatch while `confirm_delivery_atomic` and `settle_pick_atomic` raise `P0001` exceptions. The application layer in `distribution-service.ts` must check for null return explicitly. A future caller that fails to check null will silently skip the enqueue. The two other RPCs are self-guarded. Acceptable for this iteration but should be harmonized in a follow-up.

### `confirm_delivery_atomic`

Updates `distribution_outbox` from `processing` → `sent` and writes `picks`, `pick_lifecycle`, `distribution_receipts`, and `audit_log` rows. Handles the idempotent already-sent case gracefully (returns `alreadyConfirmed: true`) without re-writing dependent rows.

**Correctness:** If the outbox row is in an unexpected state that is not `sent`, returns an error JSON object. If the owning pick transition fails (returns null from UPDATE RETURNING), raises `INVALID_DELIVERY_TRANSITION` with errcode `P0001` — hard fail. The `already_sent` early-return avoids duplicate receipt and audit inserts. Correct.

### `settle_pick_atomic`

Acquires a row-level lock (`SELECT ... FOR UPDATE`) before checking pick state, preventing concurrent settlement races. Handles duplicate settlement via inline exception handler on `unique_violation`, returning `duplicate: true` without re-applying the transition. Raises `INVALID_SETTLEMENT_TRANSITION P0001` if pick is not in expected state before the lifecycle update.

**Correctness:** The `FOR UPDATE` lock is correct — it prevents two concurrent settlors from both succeeding. The duplicate detection is two-layer: explicit SELECT before INSERT, plus `EXCEPTION WHEN unique_violation`. Lifecycle and audit inserts are guarded by the state check. Correct.

## Scope Assessment

Changed files: migration, `apps/api/src/settlement-service.ts`, `apps/api/src/settlement-service.test.ts`, `apps/api/src/database-smoke.test.ts`. Scope matches the declared lock exactly. No contracts, domain, or worker files were touched.

## Settlement Service Integration

`recordInitialSettlement` tries `settlePickAtomic` first; on `isInMemoryAtomicSettlementFallback` error, falls through to sequential path. The sequential fallback is correctly gated to InMemory mode only — production Supabase always uses the atomic path. The `duplicate` return from atomic is handled correctly (returns early, no re-transition). Correct.

## Finding 2 — `enqueue_distribution_atomic` null handling in distribution service

The critique cannot verify distribution-service.ts null-handling without reading that file (not in scope for this lane). The migration is correct; the application integration is the responsibility of the caller. If distribution-service.ts does not null-check, that is a separate defect.

## Verdict

**APPROVE**

Three atomic RPCs that close the lifecycle-write-without-owning-pick-transition gap at the database level. `settle_pick_atomic` and `confirm_delivery_atomic` are hard fail-closed (P0001 exceptions). `enqueue_distribution_atomic` is soft fail (null return) — a known inconsistency flagged above, acceptable for T1 given the application layer can check null. All three use PostgreSQL transactions to ensure atomicity. Settlement service integration is correct with proper InMemory fallback scope.

`pnpm verify` 113/0 pass. Evidence bundle: `docs/06_status/proof/UTV2-920/evidence.json`.
