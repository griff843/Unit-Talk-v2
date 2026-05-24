# Proof Summary — UTV2-1087

**Issue:** INIT-1.1.4 — Freshness Honesty and Provider Auto-Quarantine
**Tier:** T1
**SHA:** 96aceb727f968e6f0dce60ac389d31310f2e1b29 (latest substantive implementation commit)

## What Changed

Three original gaps from the system blueprint closed, plus the adversarial PR review bypasses:

**Gap #2** (`candidate-pick-scanner.ts:212`): `data_freshness` was hardcoded `'fresh'` for all picks submitted by the candidate scanner. Fixed to compute from `evaluateProviderDataFreshness().staleAtScanTime`. Stale provider data now produces `data_freshness: 'stale'` in `picks.metadata`.

**Gap #19** (`circuit-breaker.ts`, `ingestor-runner.ts`): Circuit breaker was fail-open by default with no production wiring. The SGO runner now uses persistent fail-closed breakers across cycles, and open circuits throw rather than silently returning fallback data.

**Gap #49** (`provider-quarantine.ts`, `ingest-league.ts`): `ProviderQuarantineRegistry` now gates provider calls before fetch, auto-quarantines on circuit-open failures, emits structured JSON events for duplicate/no-op actions, and blocks future calls while quarantine is active.

## Verification

| Check | Result |
|---|---|
| pnpm verify | PASS — env, lint, type-check, build, test, smart-form verify, command checks |
| T1 live-DB proof | PASS — 5/5 tests against live Supabase zfzdnfwdarxucxtaojxm |
| R-level | PASS — lifecycle-fsm and ingestor-provider matched; PM-gated r4-fault-report advisory |
| Adversarial: stale snapshot | PASS — 25h-old snapshot → data_freshness: 'stale' |
| Adversarial: fresh snapshot | PASS — 5min-old snapshot → data_freshness: 'fresh' |
| Adversarial: null snapshotAt | PASS — null → data_freshness: 'stale' |
| Adversarial: fail-closed circuit | PASS — persistent runner breaker quarantines and blocks later calls |
| Adversarial: scanner metadata | PASS — runCandidatePickScan writes stale/fresh metadata end-to-end |
| Implementation SHA | 96aceb727f968e6f0dce60ac389d31310f2e1b29 |

## Live-DB Proof

5/5 tests passed against Supabase project `zfzdnfwdarxucxtaojxm`:
- Adversarial: stale (25h-old) snapshot → `data_freshness: 'stale'`
- Adversarial: fresh (5min-old) snapshot → `data_freshness: 'fresh'`
- Adversarial: null snapshotAt → `data_freshness: 'stale'` (no silent fresh default)
- Live DB: `provider_offers` accessible via `listByProvider('sgo')`
- Live DB: freshness evaluation on real `snapshot_at` timestamps from production data
