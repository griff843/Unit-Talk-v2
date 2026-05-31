# Verification: UTV2-1137 — INIT-4.2.3 Dual-Authorized Corrections

## Issue

UTV2-1137 — INIT-4.2.3 — Dual-Authorized Corrections  
**Tier:** T1 | **Executor:** Claude | **Lane:** governance

## Verification

| Check | Result |
|---|---|
| `pnpm verify` (lint + type-check + build + test) | PASS — 113 tests, 0 failures |
| `pnpm test:db` (live Supabase smoke tests) | PASS — 7 tests, 0 failures |
| T1 proof tests (4 live-DB assertions) | PASS — 4/4 |
| R-level check | PASS — no artifacts required |
| Migration applied (Supabase project `zfzdnfwdarxucxtaojxm`) | PASS |

## T1 Proof Results

```
TAP version 13
ok 1 - T1 Proof 1 — attempted UPDATE on settlement_records rejected
ok 2 - T1 Proof 2 — single-approver correction rejected by DB constraint
ok 3 - T1 Proof 3 — dual-authorized correction creates settlement_corrections record
ok 4 - T1 Proof 4 — PnL reproduces through correction chain
# tests 4  pass 4  fail 0
```

## Invariants Confirmed

- Attempted mutation of `settlement_records` rejected (SETTLEMENT_RECORD_IMMUTABLE — UTV2-1136 inherited)
- Single-approver correction rejected by DB CHECK constraint (`settlement_corrections_distinct_authorizers`)
- Dual-authorized correction (two distinct identities) inserts successfully into `settlement_corrections`
- PnL reproduced through correction chain via `resolveEffectiveSettlement` — effective result is the correction value
- Domain validation (`validateDualAuthorization`) fails closed before any DB write on same-identity violation
- `SettlementCorrection` record references both correction and prior record IDs

## Schema Changes

New table `settlement_corrections`:
- `authorizer_1 != authorizer_2` enforced by CHECK constraint
- `trg_settlement_corrections_validate` trigger validates lineage (corrects_id must match prior_record_id)
- Unique index on `settlement_record_id` (one auth record per correction)

## Files Changed

- `packages/domain/src/outcomes/settlement-correction.ts` — pure domain type + validation
- `packages/domain/src/outcomes/settlement-correction.test.ts` — 12 domain tests
- `packages/domain/src/outcomes/index.ts` — export wiring
- `apps/api/src/settlement-correction-service.ts` — service with dual-auth enforcement
- `apps/api/src/settlement-correction-service.test.ts` — 6 service tests (InMemory)
- `apps/api/src/t1-proof-utv2-1137-settlement-corrections.test.ts` — 4 live-DB T1 proof tests
- `supabase/migrations/20260531001_utv2_1137_settlement_corrections.sql` — migration
- `docs/06_status/proof/UTV2-1137/evidence.json` — evidence bundle
- `docs/06_status/proof/UTV2-1137/verification.md` — this file
