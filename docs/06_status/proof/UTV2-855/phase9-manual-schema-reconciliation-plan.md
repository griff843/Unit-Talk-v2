# UTV2-855 Phase 9 Manual Schema Reconciliation Plan

Generated: 2026-05-08T10:15:00-04:00  
Mode: planning only  
Writes performed: **none**

## Goal

Create a no-writes operator plan for the missing post-`202604300003` live schema surfaces discovered by the Phase 6 rerun.

This plan does **not**:

- apply migrations
- run `supabase db push`
- run migration repair
- run live `ALTER TABLE`
- backfill rows
- create preview branches

## Input truth

Phase 6 rerun classified the linked Supabase environment as **D3** and confirmed these missing live surfaces:

- `pick_candidates.sport_key`
- `provider_offer_line_snapshots`
- `summarize_provider_offer_history_partition(date)`
- `drop_old_provider_offer_history_partitions(integer)`
- `picks_stake_units_canonical_check`
- UTV2-854 ownership columns:
  - `pick_candidates.model_registry_id`
  - `pick_candidates.scoring_run_id`
  - `pick_candidates.ownership_timestamp`
  - `model_registry.registry_entity_type`
  - `model_registry.source_type_compatibility`
  - `model_registry.active_state`

The Phase 6 rerun also confirmed that the following local migrations are **missing from the remote ledger**:

- `202605020001_utv2_725_pick_candidates_sport_key.sql`
- `202605020002_utv2_725_backfill_pick_candidates_pick_id.sql`
- `202605030001_utv2_772_provider_offer_history_partition_retention.sql`
- `202605030002_utv2_772_provider_offer_line_snapshots.sql`
- `202605070001_utv2_845_stake_units_integrity_guard.sql`
- `202605070002_utv2_854_model_ownership_persistence.sql`

## Surface-to-migration mapping

| Missing surface | Local migration | Type | Remote ledger status | Safe to apply directly? | Risk | Recommended next action |
|---|---|---|---|---|---|---|
| `pick_candidates.sport_key` | `202605020001_utv2_725_pick_candidates_sport_key.sql` | schema-only | missing remotely | **Yes** | Medium | Best first direct candidate after operator review |
| `provider_offer_line_snapshots` | `202605030002_utv2_772_provider_offer_line_snapshots.sql` | schema + function + cron mutation | missing remotely | **No** | High | Reconcile as operator-reviewed manual delta |
| `summarize_provider_offer_history_partition(date)` | `202605030002_utv2_772_provider_offer_line_snapshots.sql` | function-only, writes via UPSERT when called | missing remotely | **No** | High | Reconcile with the table, not standalone |
| `drop_old_provider_offer_history_partitions(integer)` | `202605030001_utv2_772_provider_offer_history_partition_retention.sql` | function-only, destructive when called | missing remotely | **No** | High | Reconcile only after partition baseline is accepted |
| `picks_stake_units_canonical_check` | `202605070001_utv2_845_stake_units_integrity_guard.sql` | constraint-only | missing remotely | **Yes** | Medium | Good second direct candidate after sport_key |
| `pick_candidates.model_registry_id` | `202605070002_utv2_854_model_ownership_persistence.sql` | schema + data normalization | missing remotely | **No** | Medium-high | Keep blocked until earlier convergence is done |
| `pick_candidates.scoring_run_id` | `202605070002_utv2_854_model_ownership_persistence.sql` | schema + data normalization | missing remotely | **No** | Medium-high | Keep blocked until earlier convergence is done |
| `pick_candidates.ownership_timestamp` | `202605070002_utv2_854_model_ownership_persistence.sql` | schema + data normalization | missing remotely | **No** | Medium-high | Keep blocked until earlier convergence is done |
| `model_registry.registry_entity_type` | `202605070002_utv2_854_model_ownership_persistence.sql` | schema + data normalization | missing remotely | **No** | Medium-high | Keep blocked until earlier convergence is done |
| `model_registry.source_type_compatibility` | `202605070002_utv2_854_model_ownership_persistence.sql` | schema + data normalization | missing remotely | **No** | Medium-high | Keep blocked until earlier convergence is done |
| `model_registry.active_state` | `202605070002_utv2_854_model_ownership_persistence.sql` | schema + data normalization | missing remotely | **No** | Medium-high | Keep blocked until earlier convergence is done |

## Migration behavior classification

### 1. `202605020001_utv2_725_pick_candidates_sport_key.sql`

- Type: schema-only
- Behavior:
  - adds nullable `pick_candidates.sport_key`
  - adds `idx_pick_candidates_sport_key`
- Destructive: no
- Data-mutating: no
- Hard dependency: `202604090002_utv2_460_pick_candidates`
- Direct dependency on unrecovered remote-only migrations: no

### 2. `202605020002_utv2_725_backfill_pick_candidates_pick_id.sql`

- Type: data-mutating
- Behavior:
  - updates historical `pick_candidates` rows to backfill `pick_id`
  - also flips `shadow_mode = false` on matched rows
- Destructive: no
- Data-mutating: yes
- Hard dependency: existing `pick_candidates` and `picks`
- Direct dependency on unrecovered remote-only migrations: no
- Relevance to listed missing surfaces: indirect only

This migration is **not required** to create any of the listed missing surfaces, so it should stay out of the immediate reconciliation window unless separately approved.

### 3. `202605030001_utv2_772_provider_offer_history_partition_retention.sql`

- Type: function-only
- Behavior:
  - defines `drop_old_provider_offer_history_partitions(integer)`
  - the function drops old history partitions when called
- Destructive: yes, at function execution time
- Data-mutating at apply time: no
- Hard dependency: `202604291002_utv2_772_provider_offer_history_partitioning`
- Direct dependency on unrecovered remote-only migrations: no

### 4. `202605030002_utv2_772_provider_offer_line_snapshots.sql`

- Type: schema-only + function-only + cron mutation
- Behavior:
  - creates `provider_offer_line_snapshots`
  - creates `summarize_provider_offer_history_partition(date)`
  - unschedules and reschedules `nightly-retention-prune`
  - new cron body includes future deletes against `provider_offer_line_snapshots`
- Destructive: yes, operationally, because the scheduled body deletes retained data in future runs
- Data-mutating at apply time: yes, because it mutates cron job state
- Hard dependencies:
  - `202604291001_utv2_772_bounded_provider_offers_retention`
  - `202604291002_utv2_772_provider_offer_history_partitioning`
- Direct dependency on unrecovered remote-only migrations: no

### 5. `202605070001_utv2_845_stake_units_integrity_guard.sql`

- Type: constraint-only
- Behavior:
  - drops any pre-existing `picks_stake_units_canonical_check`
  - re-adds the constraint as `NOT VALID`
- Destructive: no
- Data-mutating: no
- Hard dependency: `public.picks`
- Direct dependency on unrecovered remote-only migrations: no

This is intentionally designed to avoid historical row rewrites.

### 6. `202605070002_utv2_854_model_ownership_persistence.sql`

- Type: schema-only + data-mutating
- Behavior:
  - adds ownership columns and indexes
  - adds `model_registry` metadata columns and indexes
  - runs an `UPDATE public.model_registry ...`
- Destructive: no
- Data-mutating: yes
- Hard dependencies:
  - `202604030001_model_registry`
  - `202604090002_utv2_460_pick_candidates`
  - `public.system_runs` baseline
- Direct dependency on unrecovered remote-only migrations: no

## Dependency findings

### No direct dependency on unrecovered remote-only versions

None of the missing post-`202604300003` surfaces map directly to the seven unrecovered remote-only migrations.

### Important indirect dependency chain

The provider-retention slice depends on late-April migrations that are **missing from the remote ledger** but are also **semantically live**:

- `202604291001_utv2_772_bounded_provider_offers_retention`
- `202604291002_utv2_772_provider_offer_history_partitioning`
- `202604291003_utv2_772_provider_offer_current_table_cutover`

Phase 6 already proved that key live objects from that slice exist:

- `provider_offer_current`
- `provider_offer_history`
- `provider_offer_staging`
- `provider_offer_history_compact`

That means the provider-retention May migrations should **not** be treated as clean, isolated, normal-apply candidates. They sit on top of a partially converged and ledger-divergent live baseline.

## Proof-bundle interpretation

### UTV2-846

[`docs/06_status/proof/UTV2-846/evidence.json`](/C:/Dev/Unit-Talk-v2-main/docs/06_status/proof/UTV2-846/evidence.json) showed a board-scan fallback for `pick_candidates.sport_key`, framed at the time as schema-cache drift.

Phase 6 authoritative schema inventory later confirmed the stronger truth:

- the physical `pick_candidates.sport_key` column is absent live

So reconciliation should treat `sport_key` as a real schema gap, not merely a cache-refresh issue.

### UTV2-845

[`docs/06_status/proof/UTV2-845/evidence.json`](/C:/Dev/Unit-Talk-v2-main/docs/06_status/proof/UTV2-845/evidence.json) proved runtime stake integrity behavior, but Phase 6 showed the DB constraint itself is still absent live.

That means `202605070001` is a convergence step, not a runtime fire drill.

### UTV2-854

[`docs/06_status/proof/UTV2-854/evidence.json`](/C:/Dev/Unit-Talk-v2-main/docs/06_status/proof/UTV2-854/evidence.json) and [`ownership-persistence-summary.json`](/C:/Dev/Unit-Talk-v2-main/docs/06_status/proof/UTV2-854/ownership-persistence-summary.json) show:

- ownership schema columns absent
- ownership write success = `0%`
- live ownership rollout still blocked

Ownership must therefore remain **after** the earlier schema convergence steps.

## Recommended apply order

### 1. `202605020001_utv2_725_pick_candidates_sport_key`

Why first:

- smallest runtime-critical gap
- no data mutation
- directly addresses the most obvious missing live surface
- removes the need to keep relying on the UTV2-846 fallback path

### 2. `202605070001_utv2_845_stake_units_integrity_guard`

Why second:

- low blast radius
- `NOT VALID` avoids rewriting historical rows
- converges DB truth with the UTV2-845 runtime proof posture

### 3. Provider-retention checkpoint

Before approving any May provider-retention writes, operator should explicitly accept that:

- `202604291001`
- `202604291002`
- `202604291003`

are not remote-ledger aligned even though their core live objects already exist.

### 4. `202605030001` + `202605030002` provider-retention slice

Recommended handling:

- treat as a **manual operator-reviewed delta**
- do **not** blindly run the files from this planning artifact alone
- separate object creation/function reconciliation from cron-body mutation review

Why:

- partition-drop behavior is inherently destructive when executed
- cron rescheduling changes production retention behavior
- the slice depends on an already divergent but semantically live provider-history baseline

### 5. `202605070002_utv2_854_model_ownership_persistence`

Why fifth:

- ownership is still blocked by design
- it includes a live `UPDATE` on `model_registry`
- the safest path is to resume ownership rollout only after earlier convergence reduces uncertainty

### 6. `202605020002_utv2_725_backfill_pick_candidates_pick_id`

Why last or defer:

- not required for the listed missing surfaces
- mutates historical rows
- should be handled only if the operator separately wants the historical linkage correction

## Risk classification

Overall classification remains **D3** until earlier missing surfaces are reconciled.

Per-slice risk:

- `202605020001`: Medium
- `202605070001`: Medium
- `202605030001`: High
- `202605030002`: High
- `202605070002`: Medium-high
- `202605020002`: Medium-high

## Operator decision summary

### Best direct candidates after operator review

- `202605020001_utv2_725_pick_candidates_sport_key`
- `202605070001_utv2_845_stake_units_integrity_guard`

### Should not be blindly direct-applied

- `202605030001_utv2_772_provider_offer_history_partition_retention`
- `202605030002_utv2_772_provider_offer_line_snapshots`

### Should remain blocked for now

- `202605070002_utv2_854_model_ownership_persistence`
- `202605020002_utv2_725_backfill_pick_candidates_pick_id`

## Can any live write be approved now?

Not from this planning artifact alone.

This plan identifies two lower-risk direct candidates, but actual write approval remains an operator decision after reviewing:

- the migration dry-run/output
- the D3 drift context
- the provider-retention baseline divergence

## No-writes confirmation

Confirmed:

- no migrations were applied
- no live SQL writes were executed
- no migration history was mutated
- no preview branches were created
- no backfill was performed
