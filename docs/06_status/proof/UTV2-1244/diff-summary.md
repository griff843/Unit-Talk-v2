# UTV2-1244 Diff Summary

## Change Summary

T1 migration lane. Adds one Supabase migration file — no app/runtime code changes.

## Files Changed

- `supabase/migrations/20260609001_utv2_1244_provider_offer_history_event_snapshot_index.sql` — new migration
- `.ops/sync/UTV2-1244.yml` — lane sync metadata
- `docs/06_status/lanes/UTV2-1244.json` — lane manifest
- `docs/06_status/proof/UTV2-1244/evidence.json` — T1 evidence bundle
- `docs/06_status/proof/UTV2-1244/verification.md` — verification proof
- `docs/06_status/proof/UTV2-1244/diff-summary.md` — this file

## Migration Details

**Index added:** `idx_provider_offer_history_event_snapshot`
**Table:** `provider_offer_history`
**Columns:** `(provider_event_id, snapshot_at)`
**Method:** btree
**Build mode:** `CONCURRENTLY IF NOT EXISTS` (no table lock during build)

## Pre-Migration Index State

Only 2 indexes existed:
- `provider_offer_history_pkey`: UNIQUE `(snapshot_at, id)`
- `provider_offer_history_snapshot_idempotency_key`: UNIQUE `(snapshot_at, idempotency_key)`

No index on `provider_event_id`. Table has 713,978 rows.

## Post-Migration Index State

3 indexes confirmed via live DB query:
- `idx_provider_offer_history_event_snapshot`: `(provider_event_id, snapshot_at)` — **NEW**
- `provider_offer_history_pkey`: UNIQUE `(snapshot_at, id)`
- `provider_offer_history_snapshot_idempotency_key`: UNIQUE `(snapshot_at, idempotency_key)`

## Impact

No app/runtime code changes. No schema column changes. No data mutations.
Unblocks UTV2-1242 closing-line timeout remediation.

## Guardrails Honored

- No provider offer data dropped or rewritten
- No table schema changes beyond index addition
- No destructive DB operations
- No UTV2-1242 implementation in this lane
- No Redis / Temporal
- No P3 certification
- No CLV / ROI claims

## SHA Binding

Merge SHA: PENDING — update post-merge before lane close.
