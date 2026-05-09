# UTV2-855 Phase 8 Migration Apply

Generated: 2026-05-08T15:25:00Z  
Mode: live migration apply and verification

## Result

Migration apply succeeded.

The manual reconciliation order was executed first, then the approved ownership migration was applied live. Ownership schema columns now exist in the linked Supabase environment, database types were regenerated, and the full verification gate passed.

## Apply sequence executed

1. `202605020001_utv2_725_pick_candidates_sport_key.sql`
2. `202605070001_utv2_845_stake_units_integrity_guard.sql`
3. `202605030001_utv2_772_provider_offer_history_partition_retention.sql`
4. `202605030002_utv2_772_provider_offer_line_snapshots.sql`
5. `202605070002_utv2_854_model_ownership_persistence.sql`

Deferred intentionally:

- `202605020002_utv2_725_backfill_pick_candidates_pick_id.sql`

That backfill was not required to recover the missing schema surfaces and was left out of the live window.

## Live schema confirmation

Confirmed live after apply:

- `pick_candidates.sport_key`
- `provider_offer_line_snapshots`
- `summarize_provider_offer_history_partition(date)`
- `drop_old_provider_offer_history_partitions(integer)`
- `picks_stake_units_canonical_check`
- `pick_candidates.model_registry_id`
- `pick_candidates.scoring_run_id`
- `pick_candidates.ownership_timestamp`
- `model_registry.registry_entity_type`
- `model_registry.source_type_compatibility`
- `model_registry.active_state`

Also confirmed:

- ownership indexes were created live
- `picks_stake_units_canonical_check` is present as `NOT VALID`, matching the migration design
- the ownership migration executed its `model_registry` normalization update

## Type generation and verification

Completed successfully:

- `pnpm supabase:types`
- `pnpm type-check`
- `pnpm test:db`
- `pnpm verify`

The regenerated live schema types required local repo convergence in:

- [types.ts](/C:/Dev/Unit-Talk-v2-main/packages/db/src/types.ts)
- [runtime-repositories.ts](/C:/Dev/Unit-Talk-v2-main/packages/db/src/runtime-repositories.ts)
- [database.types.ts](/C:/Dev/Unit-Talk-v2-main/packages/db/src/database.types.ts)

## Ownership proof result

`scripts/model-ownership/run-ownership-persistence-proof.ts` ran successfully.

The key result is split into two parts:

1. The schema is now correct live.
2. A legitimate model-attributed candidate still does **not** exist yet.

Current proof summary from [`ownership-persistence-summary.json`](/C:/Dev/Unit-Talk-v2-main/docs/06_status/proof/UTV2-854/ownership-persistence-summary.json):

- `model_attributed_pct = 0`
- `model_generated_pct = 0`
- `ownership_write_success_pct = 0`
- `ownership_write_failure_pct = 100`
- `any_model_generated_today = false`
- `true_model_generated_inventory_exists = false`

So the migration rollout succeeded, but the first legitimate model-attributed candidate has **not** appeared yet in live inventory.

## No-forbidden-actions confirmation

Confirmed not performed during this execution:

- no `supabase migration repair`
- no `supabase db push`
- no preview branch creation
- no historical ownership backfill
- no `202605020002` historical `pick_candidates.pick_id` backfill
