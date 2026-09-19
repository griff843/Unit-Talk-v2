# Command Center Module → Provider/Data Dependency Map

**Issue:** UTV2-424
**Generated:** 2026-04-07
**Authority:** This document is the canonical Phase 1 output feeding UTV2-414 (Research workspace MVP) and UTV2-417 (Decision workspace MVP). Do not write workspace MVP specs before consulting this.

---

## Legend

| Status | Meaning |
|--------|---------|
| **shippable now** | Data exists in current DB schema and is being populated. UI can ship against real data. |
| **shell only** | UI component can ship, but data source is a placeholder until a specific dependency is live. |
| **blocked: SGO primary** | Requires live SGO ingest to be active (currently active — unblock as ingestor runs) |
| **blocked: multi-book** | Requires multiple bookmaker feeds simultaneously (byBookmaker ingestion needs to stabilize) |
| **blocked: historical backfill** | Requires historical stat/outcome data not yet in DB (no player box score history table exists) |
| **blocked: CLV/line-movement** | Requires live closing-line capture and CLV settlement flow to be proven end-to-end |

---

## Data Reality Baseline (2026-04-07)

| Source | Status | Detail |
|--------|--------|--------|
| `provider_offers` | **Live** | 329k rows, 2026-01-05 → 2026-04-04. Per-bookmaker rows (Pinnacle/DK/FD/BetMGM) via `bookmaker_key`. SGO Pro active. |
| `picks` + `picks_current_state` | **Live** | Active pick lifecycle. FK columns (`capper_id`, `market_type_id`, `sport_id`) live. |
| `pick_promotion_history` | **Live** | Every promoted pick has scored rows with `edge`, `trust`, `readiness`, `uniqueness`, `boardFit`. |
| `settlement_records` | **Live schema, limited rows** | `clv_at_close` column exists. Valid CLV values not yet proven end-to-end (UTV2-335 precondition). |
| `distribution_outbox` + `distribution_receipts` | **Live** | Outbox polling active. Delivery receipts accumulating. |
| `hedge_opportunities` | **Live schema** | Table exists. Populated only when hedge conditions are detected. |
| `players`, `teams`, `events`, `event_participants` | **Live schema** | Reference data. `players` populated via ingestor. No historical stat outcomes (box scores) in DB. |
| `game_results` | **Live schema** | SGO `odds.<oddID>.score` results populated. Partial — game-line results live, prop results depend on provider grading. |
| `audit_log`, `pick_lifecycle` | **Live** | All lifecycle transitions logged. |
| `model_registry`, `model_health_snapshots` | **Live schema** | Exists. Not operationally populated (ML model ops not yet running). |

**What does NOT exist in DB:** player box score history, season/game-level stat aggregates, historical hit rates derived from external sources. Only pick-derived stats (from graded `settlement_records`) are available.

---

## Module Dependency Map

### Research Workspace

| Module | Data exists now? | Status | Canonical source | Blocker (if any) |
|--------|-----------------|--------|-----------------|-----------------|
| **Prop explorer** | Yes | **shippable now** | `provider_offers` (329k rows, live byBookmaker) | None — query by sport/market/date |
| **Player card** (identity) | Yes | **shippable now** | `players`, `player_team_assignments`, `teams` | None — identity layer is live |
| **Player card** (historical stats) | No | **blocked: historical backfill** | No player stat history table exists. Only pick-derived grading via `settlement_records`. | Add historical box score ingest or accept pick-only view |
| **Matchup card** (event identity) | Yes | **shippable now** | `events`, `event_participants`, `teams` | None — event identity live |
| **Matchup card** (comparative stats) | No | **blocked: historical backfill** | No head-to-head stat table. Only `provider_offers` for lines. | Same as player card historical |
| **Trend/split filters** | No | **blocked: historical backfill** | `settlement_records` has pick outcomes but no external stat splits | Only pick-level hit rate filters are possible now |
| **Hit rate / avg / median** | Partial | **shell only** (limited volume) | `settlement_records` + `picks` — computable but volume is low (settled picks still accumulating) | Volume gate: needs 100+ graded picks per segment for statistical significance |
| **Line-shopper** | Yes | **shippable now** | `provider_offers.bookmaker_key` (Pinnacle/DK/FD/BetMGM rows exist) | None — multi-book rows live via byBookmaker |

**Research gap summary:** Identity + offer browsing + line-shopping are shippable now. Historical stat analytics require a box score ingest pipeline that does not exist. Trend filters work only on pick-derived outcomes.

---

### Decision Workspace

| Module | Data exists now? | Status | Canonical source | Blocker (if any) |
|--------|-----------------|--------|-----------------|-----------------|
| **Score breakdown** | Yes | **shippable now** | `pick_promotion_history` — `edge`, `trust`, `readiness`, `uniqueness`, `boardFit` scores on every promoted pick | None |
| **Promotion preview** | Yes | **shippable now** | `pick_promotion_history` + promotion engine in `apps/api/src/promotion-service.ts` | None — can recompute against live picks |
| **Routing preview** | Yes | **shippable now** | `distribution_outbox` state + `picks.status` | None — routing state is deterministic from lifecycle + promotion |
| **Board saturation** | Yes | **shippable now** | `distribution_outbox` + `picks` queryable by sport/market/tier | None |
| **Hedge overlays** | Partial | **shell only** | `hedge_opportunities` table exists. Only populated when hedge conditions are detected. | Depends on active pick volume; middling requires live multi-book line comparison |
| **Middling overlays** | No | **blocked: multi-book** | Requires simultaneous multi-book line feeds to detect middling windows | byBookmaker ingestion must be proven stable across multiple books at once |

**Decision gap summary:** All scoring/routing/promotion surfaces are shippable now — data is fully live. Hedge is shell-ready (table exists, volume-dependent). Middling is blocked until multi-book ingestion is proven stable.

---

### Operations Workspace

| Module | Data exists now? | Status | Canonical source | Blocker (if any) |
|--------|-----------------|--------|-----------------|-----------------|
| **Snapshot** | Yes | **shippable now** | Exists in `apps/operator-web` — system-health, pick counts, outbox state | None — already live |
| **Picks pipeline** | Yes | **shippable now** | `picks_current_state` view — lifecycle state across all picks | None — already live |
| **Lifecycle detail** | Yes | **shippable now** | `pick_lifecycle` + `audit_log` per pick | None — already live |
| **Manual review** | Yes | **shippable now** | `pick_reviews` + manual review queue in operator-web | None — already live |
| **Recap status** | Yes | **shippable now** | `distribution_receipts` + recap tracking in operator-web | None — already live |
| **Channel health** | Yes | **shippable now** | `distribution_receipts` by target + circuit-breaker state | None — already live |

**Operations gap summary:** All Operations modules are shippable now. The entire workspace exists in `apps/operator-web` and needs to be repositioned under the unified CC shell (UTV2-420), not rebuilt.

---

### Intelligence Workspace

| Module | Data exists now? | Status | Canonical source | Blocker (if any) |
|--------|-----------------|--------|-----------------|-----------------|
| **ROI by tier** | Partial | **shell only** (volume-limited) | `settlement_records` + `picks` + `member_tiers` — query computable but insufficient settled picks yet | Volume gate: needs 50+ settled picks per tier for meaningful ROI |
| **ROI by capper** | Partial | **shell only** (volume-limited) | `settlement_records` + `picks` + `cappers` — computable today | Same volume gate |
| **ROI by market** | Partial | **shell only** (volume-limited) | `settlement_records` + `picks` + `market_types` — computable today | Same volume gate |
| **Scoring calibration** | Yes (schema) | **shell only** (code inactive) | `pick_promotion_history` + `settlement_records` — data exists. Calibration logic exists in `packages/domain` but is not operationally scheduled. | Calibration code must be activated (UTV2-335 precondition) |
| **CLV/trend cohorts** | No | **blocked: CLV/line-movement** | `settlement_records.clv_at_close` column exists in schema but valid values not yet proven end-to-end (UTV2-335 open, MI-M5 gate) | UTV2-335 must close: requires settled picks with valid `clv_at_close` values |

**Intelligence gap summary:** All ROI views are computationally possible but volume-limited today. CLV cohorts are blocked until UTV2-335 closes. Calibration needs activation, not more data.

---

## Dependency Chain Summary

```
shippable now (no blocker):
  Operations (all 6 modules)
  Decision: score breakdown, promotion preview, routing preview, board saturation
  Research: prop explorer, player card (identity), matchup card (event identity), line-shopper

shell only (limited/partial):
  Research: hit rate/avg/median (volume), player card stats (box score gap)
  Decision: hedge overlays (volume-dependent)
  Intelligence: ROI by tier/capper/market (volume gate)
  Intelligence: scoring calibration (code not activated)

blocked: historical backfill:
  Research: trend/split filters, player card historical, matchup comparative stats
  → No historical box score table in DB. Requires new ingest pipeline.

blocked: CLV/line-movement:
  Intelligence: CLV/trend cohorts
  → UTV2-335 must close first.

blocked: multi-book:
  Decision: middling overlays
  → byBookmaker ingestion must be stable across 2+ books simultaneously.
```

---

## What UTV2-414 (Research MVP) and UTV2-417 (Decision MVP) must use from this doc

- **Research MVP** can ship: Prop explorer, player identity, event identity, line-shopper. Do NOT spec historical stats, external split filters, or matchup comparative views as "v1 shippable."
- **Decision MVP** can ship: Score breakdown, promotion preview, routing preview, board saturation. Hedge is shell-only. Middling is explicitly blocked.
- **Operations** is already shippable — UTV2-420 reframes existing surfaces, not rebuilds.
- **Intelligence MVP** must note ROI views are volume-limited and CLV is explicitly blocked until UTV2-335 closes.
