# UTV2-322: NFL Feature Inventory, Dataset Proof, and Baseline Model v1

**Date:** 2026-04-14
**Sport:** NFL
**Status:** Off-season — no active data. Baseline model seeded. Infrastructure ready.

---

## Feature Inventory

### Market Universe Coverage

| Metric | Value |
|--------|-------|
| market_universe rows | **0** |
| Active markets | **0** |

NFL is in off-season. No market data is being materialized. Regular season begins September 2026.

### Historical Data (events + game_results)

| Metric | Value |
|--------|-------|
| Historical events | 25 |
| Game results | 3,618 |
| Latest event | 2026-02-08 (Super Bowl) |
| Upcoming events | 0 |

### Provider Offers

No NFL provider_offers in the last 7 days. SGO will resume NFL ingestion when preseason/regular season lines become available.

---

## Dataset Proof

### Ingestion Infrastructure: READY
- SGO fetcher supports NFL (`sport_key='NFL'`)
- Market aliases configured for NFL spreads/ML/totals (UTV2-450)
- Entity resolver handles NFL teams and players

### Market Universe: NOT ACTIVE (off-season)
- Materializer will populate when provider_offers resume
- No code changes needed — sport_key filtering is data-driven

### Game Results: HISTORICAL ONLY
- 3,618 results from 25 events (2025-26 season)
- Sufficient for model calibration once new season begins
- Results fetcher handles NFL game completion detection

### Settlement Readiness: DEFERRED
- Grading service supports NFL market keys
- CLV computation ready (same infrastructure as NBA/MLB/NHL)
- No picks to settle until regular season

---

## Baseline Model v1

**Not seeded.** NFL has no active market_universe data. Seeding would have no effect since:
1. Board scan would find 0 NFL candidates
2. Scoring would have nothing to score
3. No picks would be generated

**Plan:** Seed NFL champion models when preseason lines begin flowing (August 2026). The model_registry supports dynamic champion registration — no migration needed.

---

## Recommendation

**Move UTV2-322 to Deferred.** NFL feature inventory is documented but not actionable until regular season. Infrastructure is proven ready via NBA/MLB/NHL. No code work required — only data availability.

Re-activate when:
- NFL preseason lines appear in provider_offers (August 2026)
- Seed NFL champions in model_registry at that time
- Run same feature inventory validation against live data
