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
**Build mode:** `IF NOT EXISTS` (CONCURRENTLY omitted — provider_offer_history is a partitioned table; PostgreSQL disallows CONCURRENTLY on partitioned parent tables)

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
Provides an efficient event lookup path for the ingestor recovery lane (D4 resolution).

## Guardrails Honored

- No provider offer data dropped or rewritten
- No table schema changes beyond index addition
- No destructive DB operations
- No Redis / Temporal
- No P3 certification
- No CLV / ROI claims

## SHA Binding

Verified source SHA: `1a7e4b28a6390f2fe0c91f9034393252336ae977`
Merge SHA: `6d74bbbe8afce119eef2d8f154359ba1ba28e860` (PR #997 squash merge onto main, 2026-06-09).
