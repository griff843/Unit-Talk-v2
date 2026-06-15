# Pre-baseline migration archive

The migrations in this directory are **historical and non-replayable**. They are
preserved for provenance only. They are **not** applied by `supabase db reset`, the Live
Schema Parity job, or any other automation — only files under `supabase/migrations/` are.

## Why these were archived

Live Schema Parity (UTV2-1274) requires the repo migrations to replay cleanly from
scratch against a Supabase-shaped database and match live. The pre-baseline ledger could
not satisfy this: it was **bidirectionally divergent** from live.

- Live contained objects the repo migrations never created (out-of-band changes).
- The repo contained migrations live never applied.
- At least one migration referenced a column that exists nowhere — neither in scratch
  nor on live (e.g. `market_universe.provider`) — so a from-scratch replay aborted
  partway through.

Chasing the old history migration-by-migration could not converge. Per PM decision
(Option B: baseline/squash), the ledger was reset to a single faithful snapshot of live.

## The replay root

`supabase/migrations/00000000000000_baseline_live_schema.sql` is a schema-only snapshot
of the live database, generated in CI by the **Schema Baseline Dump** workflow
(`.github/workflows/schema-baseline-dump.yml`) and validated by replaying it alone on a
Supabase local stack and comparing the result back to live.

**This baseline is the replay root.** Every migration in this archive predates it and is
already represented in it. All future schema changes are **forward-only** migrations
added under `supabase/migrations/` after the baseline.

## Dynamic partition children

The baseline intentionally omits the runtime-created
`provider_offer_history_p<YYYYMMDD>` partition children (live creates these on a schedule,
so baking today's children in would guarantee drift tomorrow). The parent partitioned
table, its partition-management function, and `provider_offer_history_compact` are
retained. Live Schema Parity excludes the same dynamic children from its comparison via
`--exclude-relation-pattern` so they never read as drift.

## Rollback

These archived migrations are not reversible as a unit. The recovery path for the live
database is Point-In-Time Recovery — see `docs/05_operations/DB_ROLLBACK_RUNBOOK.md`.
