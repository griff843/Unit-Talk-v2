# UTV2-579 Diff Summary

| Field | Value |
|---|---|
| Issue | UTV2-579 — Add live freshness and stage-proof checks for the governed pick machine |
| PR | #331 |
| Branch | griffadavi/utv2-579-audit-blocker-add-live-freshness-and-stage-proof-checks-for |
| Tier | T2 |

## Files Changed

- `scripts/stage-freshness-checks.ts` — new file, 305 lines
- `package.json` — added `"stage:freshness": "tsx scripts/stage-freshness-checks.ts"` script entry

## Implementation Summary

8-stage pipeline freshness check covering the full governed machine:
- **offers** → `provider_offers` (snapshot_at, 60m threshold)
- **market_universe** → `market_universe` (refreshed_at, 120m threshold)
- **candidates** → `pick_candidates` (created_at, 240m threshold)
- **scoring** → `pick_candidates` where model_score IS NOT NULL (240m threshold)
- **board** → `pick_candidates` where is_board_candidate = true (240m threshold)
- **picks** → `picks` (created_at, 240m threshold)
- **outbox** → `distribution_outbox` (created_at, pending/completed counts, 240m threshold)
- **receipts** → `distribution_receipts` (recorded_at, 240m threshold)

Each stage emits: state (FRESH/STALE/EMPTY), latest age in minutes, row count in window, threshold.
Overall verdict: HEALTHY (all FRESH) / DEGRADED (any STALE) / FAILED (any EMPTY).
Supports `--json`. Exits 1 on non-HEALTHY.
