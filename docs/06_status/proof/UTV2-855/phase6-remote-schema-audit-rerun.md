# UTV2-855 Phase 6 Remote Schema Audit Rerun

Generated: 2026-05-08T09:41:14.2862100-04:00  
Mode: read-only remote schema audit rerun  
Route: Docker-backed PostgreSQL client through the Supabase pooler

## Result

Classification: **D3**

The authoritative rerun succeeded through the Docker-backed pooler route, but the live schema is still missing multiple local schema changes beyond the ownership migration. Because the remote baseline is not "ownership-only pending", the ownership migration apply must **not** be approved yet.

## Read-only route used

- Host: `aws-1-us-west-2.pooler.supabase.com`
- Port: `5432`
- Client: disposable `postgres:17-alpine` Docker container
- Raw outputs: `.temp/utv2-855-phase6-rerun/results/`
- Schema dump: `.temp/utv2-855-phase6-rerun/public-schema.sql`

## No-writes confirmation

Confirmed:

- no `supabase db push`
- no `supabase migration repair`
- no live `ALTER TABLE`
- no migration-ledger mutation
- no row backfill
- no preview branch creation

## 14 checks completed

All 14 read-only inventory checks from the Phase 5 plan were executed against the live schema:

1. tables
2. columns
3. indexes
4. constraints
5. triggers
6. functions
7. RLS policies
8. RLS-enabled tables
9. enums
10. views
11. migration ledger
12. extensions
13. ownership precheck
14. priority-target deep check

One live-shape adjustment was required:

- the Phase 5 plan expected `supabase_migrations.schema_migrations.inserted_at`
- the live ledger does not expose `inserted_at`
- the rerun used the actual live ledger columns instead: `version`, `statements`, `name`, `created_by`, `idempotency_key`, `rollback`

## Inventory summary

- `72` total tables across `public` and `supabase_migrations`
- `66` public base tables
- `5` public views
- `994` public columns
- `329` public indexes
- `815` public constraints
- `22` public triggers
- `22` public functions
- `65` public tables with RLS enabled
- `0` public RLS policies
- `0` public enums
- `6` installed extensions

## Ownership column result

Ownership columns do **not** exist live.

Absent on `pick_candidates`:

- `model_registry_id`
- `scoring_run_id`
- `ownership_timestamp`

Absent on `model_registry`:

- `registry_entity_type`
- `source_type_compatibility`
- `owner`
- `training_window_start`
- `training_window_end`
- `validation_metrics`
- `calibration_metadata`
- `promotion_approved_by`
- `promotion_approved_at`
- `active_state`

This confirms the ownership migration has **not** been applied live.

## What matched live

The rerun confirmed that several previously suspicious remote-only ledger entries are materially represented in the live schema:

- `add_stake_units_to_settlement_records_with_trigger` is reflected by `settlement_records.stake_units`, `settlement_records_populate_stake_units()`, and `trg_settlement_records_stake_units`
- `utv2_727_*` objects are reflected live, including `sgo_replay_coverage`
- `utv2_752` and `utv2_82` equivalents are reflected in the live baseline
- `pick_offer_snapshots` exists live with `snapshot_kind` and supporting indexes
- `provider_offer_current`, `provider_offer_history`, `provider_offer_staging`, and `provider_offer_history_compact` all exist live
- `experiment_ledger` exists and its `run_type` constraint includes `calibration`
- RLS is enabled on canonical public tables, with no public client policies attached

## Schema anomalies

The blocker is not the old remote-only history by itself. The blocker is that the live schema is still missing later local schema changes that matter beyond ownership:

1. `pick_candidates.sport_key` is missing live, even though local migration `202605020001_utv2_725_pick_candidates_sport_key.sql` adds it and repo tests/app surfaces expect it.
2. `provider_offer_line_snapshots` is missing live, even though local migration `202605030002_utv2_772_provider_offer_line_snapshots.sql` creates it and ingestion retention code references it.
3. `summarize_provider_offer_history_partition(date)` is missing live.
4. `drop_old_provider_offer_history_partitions(integer)` is missing live.
5. `picks_stake_units_canonical_check` is missing live, even though local migration `202605070001_utv2_845_stake_units_integrity_guard.sql` defines it.
6. All UTV2-854 ownership columns remain absent live.
7. The live migration ledger shape differs from the Phase 5 planning assumption because it has no `inserted_at` column.

## Migration ledger state

- Remote ledger entries: `90`
- Local migration files: `99`
- Remote-only versions still present: `7`
- Local-only versions absent from remote ledger: `16`

Some local-only versions are data-only or were superseded by equivalent remote versions, but several schema-affecting local migrations remain missing live, which prevents a safe D1 decision.

## Decision

Do **not** apply `supabase/migrations/202605070002_utv2_854_model_ownership_persistence.sql` yet.

Operator approval for migration apply is **not** appropriate at this stage because the remote schema is not limited to a single pending ownership migration. A manual reconciliation plan is required first for the missing post-20260430 schema changes.

## Required next step

Stop here and prepare a manual reconciliation plan for the missing live schema surfaces before any ownership migration apply is attempted.
