# UTV2-1011 Diff Summary

Merge SHA: 287d05aa1dc26cb8904ffe69fc4cd1ff0605b17b

## Summary

Restored provider-offer freshness reporting by fixing health scripts to query the post-UTV2-772 cutover table (`provider_offer_current`) instead of the legacy archive (`provider_offers`).

## Root Cause

After the UTV2-772 `provider_offer_current` table cutover migration, the ingestor correctly writes to `provider_offer_current` (hot table, 255,808 rows) and `provider_offer_history` (archive). However, `stage-freshness-checks.ts` and `runtime-health.ts` still queried `provider_offers.snapshot_at` (legacy archive, last written April 29, 2026). This caused false staleness reports — the data was fresh but the health scripts looked at the wrong table.

**Root cause classification:** Architecture mismatch (NOT auth failure, NOT scheduler failure, NOT runtime failure)

- SGO API key: Active (200 OK, `isActive: true`, pro tier)
- Ingestor scheduler: Working correctly
- Data freshness: `provider_offer_current` updated to 5m ago during this lane

## Files Changed

- `scripts/stage-freshness-checks.ts` — changed Offers check from `provider_offers.snapshot_at` to `provider_offer_current.updated_at`
- `scripts/runtime-health.ts` — changed Provider Freshness check from `provider_offers.snapshot_at` to `provider_offer_current.updated_at`
- `scripts/ingestor-status.mjs` — (no change; correctly reports from DB)
- `docs/06_status/lanes/UTV2-1011.json` — lane manifest with expanded scope
- `docs/06_status/proof/UTV2-1011/evidence.json` — T1 evidence bundle
- `docs/06_status/proof/UTV2-1011/diff-summary.md` — this file
- `docs/06_status/proof/UTV2-1011/verification.md` — verification log

## Before State

| Metric | Value |
|--------|-------|
| `provider_offer_current.updated_at` (latest) | 2026-04-29T13:04:29Z (31,624m ago) |
| `stage:freshness` Offers | STALE |
| `runtime:health` Provider | FAILED |

## After State

| Metric | Value |
|--------|-------|
| `provider_offer_current.updated_at` (latest) | 2026-05-21T12:12:56Z (5m ago) |
| `stage:freshness` Offers | FRESH (11,854 rows in 60m window) |
| `stage:freshness` Market Universe | FRESH |
| `runtime:health` Provider | HEALTHY |

## Scope Note

`stage:freshness` overall verdict remains FAILED due to downstream pipeline stages (Candidates, Scoring, Board) that depend on model scoring and pick generation — separate from offer freshness. Offer freshness acceptance criterion is satisfied.
