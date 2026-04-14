# UTV2-321: MLB Feature Inventory, Dataset Proof, and Baseline Model v1

**Date:** 2026-04-14
**Sport:** MLB
**Status:** Dataset proven, baseline model seeded

---

## Feature Inventory

### Market Universe Coverage (live as of 2026-04-14 16:31 UTC)

| Market Type ID | Rows | Active | Has Fair Prob | Family |
|---------------|------|--------|--------------|--------|
| *(null — unmapped)* | 980 | 732 | 777 | — |
| player_batting_hits_ou | 166 | 88 | 166 | player_prop |
| player_batting_home_runs_ou | 152 | 81 | 136 | player_prop |
| player_batting_rbi_ou | 143 | 76 | 128 | player_prop |
| player_batting_total_bases_ou | 138 | 71 | 135 | player_prop |
| player_batting_walks_ou | 137 | 76 | 137 | player_prop |
| player_batting_hrr_ou | 136 | 62 | 136 | player_prop |
| player_batting_singles_ou | 134 | 67 | 134 | player_prop |
| player_batting_doubles_ou | 98 | 59 | 98 | player_prop |
| player_batting_triples_ou | 92 | 46 | 92 | player_prop |
| player_pitching_strikeouts_ou | 18 | 10 | 18 | player_prop |
| player_pitching_earned_runs_ou | 15 | 9 | 15 | player_prop |
| player_pitching_hits_allowed_ou | 14 | 8 | 14 | player_prop |
| player_pitching_outs_ou | 12 | 6 | 12 | player_prop |
| moneyline | 9 | 5 | 0 | game_line |
| spread | 9 | 5 | 0 | game_line |

**Total:** 2,253 market_universe rows across 16 market types

### Provider Offers (last 7 days)

| Provider | Offers | Events | Openings | Closings | Latest |
|----------|--------|--------|----------|----------|--------|
| sgo | 286,509 | 46 | 235,294 | 130,435 | 2026-04-14 19:44 UTC |

### Game Results (grading readiness)

| Market Key | Results | Latest |
|-----------|---------|--------|
| player_points_ou | 3,402 | today |
| batting_stolenBases-all-game-ou | 3,312 | today |
| batting_strikeouts-all-game-ou | 3,264 | today |
| batting_hits-all-game-ou | 2,846 | today |
| batting_homeRuns-all-game-ou | 2,753 | 2026-04-09 |
| batting_singles-all-game-ou | 2,730 | 2026-04-09 |
| batting_RBI-all-game-ou | 2,639 | 2026-04-09 |
| player_batting_hits_ou | 873 | today |
| player_batting_home_runs_ou | 872 | today |
| player_batting_rbi_ou | 872 | today |
| player_batting_singles_ou | 871 | today |

**Total MLB game results:** 46,534 across 395 events

### Events Coverage

| Metric | Value |
|--------|-------|
| Total events | 395 |
| Upcoming | 0 (today's games in progress) |
| Furthest event date | 2026-04-14 |

---

## Dataset Proof

### Ingestion: PROVEN
- 286,509 provider_offers in last 7 days from SGO
- 235,294 opening lines, 130,435 closing lines
- Active data flow as of today

### Market Universe: PROVEN
- 2,253 rows, 1,401 active (non-stale)
- 14 player prop market types with fair probability computation
- 2 game line market types (moneyline, spread)

### Game Results: PROVEN
- 46,534 results across 395 events
- Active ingestion today across all major market keys
- Both canonical (player_batting_*_ou) and SGO-native (batting_*-all-game-ou) keys present

### Settlement Readiness: PARTIAL
- Game results flowing for grading
- CLV computation requires closing_line data (currently 0 rows with closing_line in market_universe)
- Opening/closing line tags present in provider_offers (130K closings)
- Gap: market_universe materializer not yet writing closing_line from provider_offers

---

## Baseline Model v1

Seeded 2026-04-14 in `model_registry`:

| Model | Sport | Family | Sharp Weight | Movement Weight | Confidence |
|-------|-------|--------|-------------|----------------|------------|
| mlb-player-prop-baseline | MLB | player_prop | 0.30 | 0.20 | 0.65 |
| mlb-game-line-baseline | MLB | game_line | 0.35 | 0.25 | 0.68 |
| mlb-combo-baseline | MLB | combo | 0.25 | 0.15 | 0.60 |

All models status=champion, champion_since=2026-04-14.

---

## Gaps and Next Steps

1. **Closing line gap:** 980 null market_type_id rows need mapping; closing_line column empty in market_universe
2. **Fair prob on game lines:** moneyline/spread rows have 0 fair_over_prob — devig not applied to 2-way markets
3. **Player enrichment:** 3,423 players but sport metadata not tagged (all show "unknown")
4. **Market key alignment:** SGO-native keys (batting_*-all-game-ou) vs canonical keys (player_batting_*_ou) both present in game_results — alias resolution working
