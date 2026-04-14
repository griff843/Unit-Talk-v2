# UTV2-323: NHL Feature Inventory, Dataset Proof, and Baseline Model v1

**Date:** 2026-04-14
**Sport:** NHL
**Status:** Dataset proven, baseline model seeded, playoffs imminent

---

## Feature Inventory

### Market Universe Coverage (live as of 2026-04-14 16:11 UTC)

| Market Type ID | Rows | Active | Has Fair Prob | Family |
|---------------|------|--------|--------------|--------|
| player_goals_ou | 122 | 122 | 103 | player_prop |
| *(null — unmapped)* | 106 | 106 | 71 | — |
| player_hockey_points_ou | 53 | 53 | 52 | player_prop |
| player_assists_ou | 48 | 48 | 48 | player_prop |
| player_shots_ou | 38 | 38 | 38 | player_prop |
| player_blocked_shots_ou | 16 | 16 | 16 | player_prop |
| moneyline | 13 | 13 | 0 | game_line |
| spread | 8 | 8 | 0 | game_line |
| player_saves_ou | 3 | 3 | 3 | player_prop |

**Total:** 407 market_universe rows, all active (0% stale), 9 market types

### Game Results (grading readiness)

| Market Key | Results | Latest |
|-----------|---------|--------|
| player_points_ou | 16,629 | today |
| goals+assists-all-game-ou | 8,199 | 2026-04-09 |
| player_assists_ou | 8,037 | today |
| shots_onGoal-all-game-ou | 6,937 | 2026-04-09 |
| powerPlay_goals+assists-all-game-ou | 6,413 | today |
| player_blocks_ou | 1,854 | today |
| player_hockey_points_ou | 626 | today |
| player_shots_ou | 474 | today |

**Total NHL game results:** 60,355 across 480 events

### Events Coverage

| Metric | Value |
|--------|-------|
| Total events | 480 |
| Upcoming | 6 |
| Furthest event | 2026-04-15 |

---

## Dataset Proof

### Ingestion: PROVEN
- Active data flow from SGO provider
- All 407 market_universe rows refreshed today
- 0% stale rate (all markets current)

### Market Universe: PROVEN
- 6 player prop market types with fair probability
- 2 game line market types (moneyline, spread)
- 100% active rate — strongest of all 3 sports

### Game Results: PROVEN
- 60,355 results — highest volume per-event density
- Active ingestion today
- Both canonical and SGO-native keys present

### Settlement Readiness: PARTIAL
- Same closing_line gap as MLB (0 rows with closing_line in market_universe)
- Game results flowing for grading
- 6 upcoming events provide immediate settlement opportunity

---

## Baseline Model v1

Seeded 2026-04-14 in `model_registry`:

| Model | Sport | Family | Sharp Weight | Movement Weight | Confidence |
|-------|-------|--------|-------------|----------------|------------|
| nhl-player-prop-baseline | NHL | player_prop | 0.30 | 0.20 | 0.65 |
| nhl-game-line-baseline | NHL | game_line | 0.40 | 0.30 | 0.70 |
| nhl-combo-baseline | NHL | combo | 0.25 | 0.15 | 0.60 |

---

## NHL-Specific Observations

1. **Highest data quality:** 100% active rate, 0% stale — NHL markets refresh more reliably
2. **Rich player prop coverage:** Goals, assists, points, shots, blocked shots, saves
3. **Playoff timing:** NHL playoffs start mid-April — immediate high-value testing window
4. **Game result density:** 60K results from 480 events = 125 results/event average
