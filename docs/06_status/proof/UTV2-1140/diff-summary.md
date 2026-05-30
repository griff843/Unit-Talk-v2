# UTV2-1140 Diff Summary

## Summary

INIT-4.3.3 — Fallback Audit Events. When CLV resolves from a secondary fallback source (rank 3 consensus or rank 4 market_universe_fallback), an AuditEvent is emitted. Fallback source use is now auditable as a first-class event per Blueprint Layer 3.12.

## Changes

- `apps/api/src/clv-service.ts`: Added `isCLVFallbackSource(v: ClosingSourceVerification): boolean` — returns true when rank >= 3
- `apps/api/src/settlement-service.ts`: Added `emitClvFallbackAuditIfNeeded()` helper; wired into `recordGradedSettlement` after CLV outcome
- `apps/api/src/clv-service.test.ts`: Added 2 INIT-4.3.3 tests for `isCLVFallbackSource`

## Scope

All changes within `apps/api/src/`. No Tier C modifications. No DB schema changes.

## Invariant enforced

Fallback source use emits an AuditEvent. `emitClvFallbackAuditIfNeeded` is a no-op for rank 1–2 (primary sources) and fires for rank 3–4.
