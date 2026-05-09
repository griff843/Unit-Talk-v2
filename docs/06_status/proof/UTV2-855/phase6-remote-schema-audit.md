# UTV2-855 Phase 6 Remote Schema Audit

Generated: 2026-05-07T23:18:08.5629313-04:00
Mode: read-only remote schema audit

## Result

Case classification: **D4**

Reason: the remote schema could only be inspected **partially**. We were able to confirm migration-ledger state and generate the remote type surface, but we could not obtain a trustworthy full catalog inventory for indexes, constraints, triggers, RLS policies, enums, and full function/view definitions.

## What was successfully confirmed

Using read-only management-API-backed commands:

- remote migration ledger still includes the seven unrecovered remote-only versions:
  - `20260424202018`
  - `20260425030626`
  - `20260425030656`
  - `20260425132920`
  - `20260427045252`
  - `20260427182229`
  - `202604300003`
- remote generated types succeeded
- the remote type surface includes the core tables needed for this lane:
  - `pick_candidates`
  - `model_registry`
  - `system_runs`
  - `experiment_ledger`
  - `provider_offers`
  - `provider_offer_current`
  - `provider_offer_history`
- the ownership columns are still absent in the remote type surface:
  - `pick_candidates.model_registry_id`
  - `pick_candidates.scoring_run_id`
  - `pick_candidates.ownership_timestamp`
  - `model_registry.registry_entity_type`
  - `model_registry.source_type_compatibility`
  - `model_registry.active_state`

Partial remote inventory confirmed from generated types:

- tables: `66`
- views: `5`
- functions: `15`

## What could not be completed reliably

The full schema inventory required by the Phase 5 plan could not be completed.

Blocked paths:

- direct DB-host inspection still fails DNS resolution on `db.zfzdnfwdarxucxtaojxm.supabase.co`
- `supabase db dump --linked --schema public --file ...` failed because the local environment lacks the Docker/`pg_dump` path the CLI expects
- `supabase inspect db table-stats` and `index-stats` timed out
- `supabase inspect db role-stats` failed during scan

Because of that, we could **not** gather a trustworthy authoritative inventory for:

- indexes
- constraints
- triggers
- RLS policies
- enums
- full view definitions
- full function definitions

## Why this is D4, not D1/D2/D3

- Not D1: we cannot prove the remote schema is a clean baseline.
- Not D2: we cannot prove remote-only intentional objects well enough to baseline them.
- Not D3: we do not have enough authoritative catalog detail to prove risky unknown drift.
- D4 fits: the remote schema cannot be inspected reliably enough to complete the decision tree.

## Recommended operator action

Restore a trustworthy read-only schema inspection path, then rerun the audit.

Acceptable next paths:

- Supabase MCP `execute_sql` access
- working `psql` or `pg_dump` access against the pooler/read-only connection
- Docker-backed `supabase db dump` on a machine where Docker Desktop is available

Only after that deeper inventory exists can we responsibly classify D1, D2, or D3.

## No writes performed

Confirmed:

- no migrations applied
- no migration repair run
- no `supabase db push`
- no preview branches created
- no live `ALTER TABLE`
- no remote writes executed
