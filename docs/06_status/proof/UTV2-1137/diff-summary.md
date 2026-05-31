# Diff Summary: UTV2-1137 — INIT-4.2.3 Dual-Authorized Corrections

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/20260531001_utv2_1137_settlement_corrections.sql` | New — creates `settlement_corrections` table |
| `db/migrations-rollback/20260531001_utv2_1137_settlement_corrections.down.sql` | New — rollback drops table, trigger, function |
| `packages/domain/src/outcomes/settlement-correction.ts` | New — pure domain type + validation |
| `packages/domain/src/outcomes/settlement-correction.test.ts` | New — 15 domain tests |
| `packages/domain/src/outcomes/index.ts` | Modified — export `settlement-correction.js` |
| `apps/api/src/t1-proof-utv2-1137-settlement-corrections.test.ts` | New — 4 live-DB T1 proof tests |

## Summary

Creates `settlement_corrections` table enforcing dual-authorization on every settlement correction. DB-level enforcement via:
- CHECK constraint: `authorizer_1 != authorizer_2`
- BEFORE INSERT trigger: validates lineage (corrects_id must match prior_record_id)
- UNIQUE index: one authorization record per correction

Domain validation (`validateDualAuthorization`) provides fail-closed checks at the service boundary. T1 proof tests verify all invariants against live Supabase.
