# UTV2-1085 Proof — INIT-1.1.2: Immutable OddsSnapshot Table and Triggers

## Summary

Implements an append-only `odds_snapshots` table with immutability triggers enforced at the DB level. Closes catastrophic gap #6 (provider_offer_current overwrote odds in place). Every observed price is now an immutable, lineage-complete snapshot.

## Deliverables

| Artifact | Path |
|---|---|
| Migration (up) | `supabase/migrations/20260523002_utv2_1085_odds_snapshots.sql` |
| Migration (down) | `db/migrations-rollback/20260523002_utv2_1085_odds_snapshots.down.sql` |
| Repository interface | `packages/db/src/repositories.ts` — `OddsSnapshotRepository` |
| Repository impl | `packages/db/src/runtime-repositories.ts` — `InMemory` + `Database` |
| Ingestor (Odds API) | `apps/ingestor/src/ingest-odds-api.ts` |
| Ingestor (SGO) | `apps/ingestor/src/ingest-league.ts` |
| T1 live-DB proof | `apps/ingestor/src/t1-proof-utv2-1085-odds-snapshot.test.ts` |

## Constitutional Claims

- **Invariant 10 (fail-closed):** snapshot trigger raises EXCEPTION on UPDATE/DELETE — no silent bypass
- **Invariant 11 (mechanical enforcement):** immutability is enforced at DB layer, not application layer
- **WS-1.1 substrate:** every price observation is captured as an immutable lineage-bearing snapshot
- **Correction model:** corrections append new rows with `prior_snapshot_id` lineage — never mutate prior snapshots
- **Gap #6 closed:** `provider_offer_current` still operates but `odds_snapshots` now provides the immutable truth basis for replay

## Test Results

- `pnpm verify`: 489 pass, 0 fail
- `pnpm test:db`: green
- T1 live-DB proof (4/4 PASS):
  1. INSERT succeeds via repository
  2. Correction appends new row with prior_snapshot_id lineage
  3. UPDATE blocked by immutability trigger
  4. DELETE blocked by immutability trigger

## Runtime Verification

See `runtime-verification.md` for live DB evidence.
