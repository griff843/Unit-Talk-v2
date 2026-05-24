# Proof Summary — UTV2-1087

**Issue:** INIT-1.1.4 — Freshness Honesty and Provider Auto-Quarantine
**Tier:** T1
**SHA:** f6720b7506f297fb5dd1687866e186123762b590 (implementation commit)

## What Changed

Three gaps from the system blueprint closed:

**Gap #2** (`candidate-pick-scanner.ts:212`): `data_freshness` was hardcoded `'fresh'` for all picks submitted by the candidate scanner. Fixed to compute from `evaluateProviderDataFreshness().staleAtScanTime`. Stale provider data now produces `data_freshness: 'stale'` in `picks.metadata`.

**Gap #19** (`circuit-breaker.ts`): Circuit breaker was fail-open by default with no opt-out. Added `failClosed?: boolean` option and `CircuitOpenError` class. When `failClosed: true`, an open circuit throws rather than silently returning a fallback. Existing callers unchanged (backward-compatible).

**Gap #49** (`provider-quarantine.ts`): New `ProviderQuarantineRegistry` tracks quarantined providers in-memory. Wired into `ingest-league.ts` — when a `CircuitOpenError` is caught, the provider is auto-quarantined with structured JSON audit logging.

## Verification

| Check | Result |
|---|---|
| pnpm verify | PASS — 497/497 tests, type-check clean, lint clean |
| T1 live-DB proof | PASS — 5/5 tests against live Supabase zfzdnfwdarxucxtaojxm |
| R-level | PASS — no artifacts required (R0) |
| Adversarial: stale snapshot | PASS — 25h-old snapshot → data_freshness: 'stale' |
| Adversarial: fresh snapshot | PASS — 5min-old snapshot → data_freshness: 'fresh' |
| Adversarial: null snapshotAt | PASS — null → data_freshness: 'stale' |
| Adversarial: fail-closed circuit | PASS — CircuitOpenError thrown |
| Implementation SHA | bace9cf452ee4d7bbed124ea81fbd5146b896ee0 |

## Live-DB Proof

5/5 tests passed against Supabase project `zfzdnfwdarxucxtaojxm`:
- Adversarial: stale (25h-old) snapshot → `data_freshness: 'stale'`
- Adversarial: fresh (5min-old) snapshot → `data_freshness: 'fresh'`
- Adversarial: null snapshotAt → `data_freshness: 'stale'` (no silent fresh default)
- Live DB: `provider_offers` accessible via `listByProvider('sgo')`
- Live DB: freshness evaluation on real `snapshot_at` timestamps from production data
