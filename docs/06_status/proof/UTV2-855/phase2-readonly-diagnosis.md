# UTV2-855 Phase 2 Read-only Diagnosis

Generated: 2026-05-07T22:05:37.1353370-04:00

## Result

Classification: **Case D - corrupted/orphaned migration history**

This is **not** a clean Case A.

## Remote migration history finding

Read-only inspection via `npx supabase migration list --linked` showed:

- `202605070002_utv2_854_model_ownership_persistence.sql` is **not recorded remotely**
- remote history includes versions that do **not** exist in the local `supabase/migrations/` directory:
  - `20260424202018`
  - `20260425030626`
  - `20260425030656`
  - `20260425132920`
  - `20260427045252`
  - `20260427182229`
  - `202604300003`
- `supabase db push --dry-run` failed with:
  - `Remote migration versions not found in local migrations directory.`

That is the decisive evidence against Case A.

## Live schema finding

Read-only schema inspection via `npx supabase gen types typescript --project-id zfzdnfwdarxucxtaojxm --schema public` showed that the linked environment still lacks all required ownership fields:

- `pick_candidates.model_registry_id` - absent
- `pick_candidates.scoring_run_id` - absent
- `pick_candidates.ownership_timestamp` - absent
- `model_registry.registry_entity_type` - absent
- `model_registry.source_type_compatibility` - absent
- `model_registry.active_state` - absent

This matches the UTV2-854 proof bundle and confirms the live environment still cannot persist legitimate model ownership.

## Why the classification is Case D

- Case A would require a clean "missing migration only" picture.
- Instead, the remote ledger contains remote-only versions that are not on disk locally.
- Case B does not fit because `202605070002` is **not** recorded remotely.
- Case C is weaker than Case D here because we did **not** observe partial ownership-column drift; we observed a migration-history mismatch plus absent ownership columns.
- Case E does not fit as the primary classification because management-API reads succeeded and confirmed real divergence, even though direct DB-host introspection still fails DNS.

## Operator approval status

Operator approval should **not** proceed directly to migration apply yet.

The next approval target is reconciliation planning for the remote migration ledger, because a normal apply path is currently blocked by the orphaned/remote-only migration history entries reported by Supabase CLI dry-run.

## No writes performed

Confirmed:

- no migrations applied
- no migration repair run
- no schema writes executed
- no Supabase branches created
- no destructive commands run
