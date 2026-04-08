# CC Research Workspace — Player Research Data Model Requirements

> **Linear:** UTV2-415
> **Type:** Requirements spec — no migration, no implementation
> **Status:** Spec complete. Implementation blocked by live SGO historical stat depth.
> **Workspace:** Research (Track B — Player Cards and Matchup Views)

---

## Purpose

This document defines the field shapes required to power player cards and matchup views in the Command Center Research workspace. It does not prescribe storage implementation, API routes, or migration order. All shapes are grounded in confirmed repo types from `packages/domain`, `packages/contracts`, and the live Supabase schema.

---

## 1. Player Identity Shape

**Source of truth:** `public.players` + `public.player_team_assignments` (migration `202604020001`)

```typescript
interface PlayerIdentity {
  // Core identity — confirmed from public.players
  player_id: string;           // uuid, PK in players table
  display_name: string;        // picks.participant_name canonical form
  first_name: string | null;
  last_name: string | null;
  active: boolean;

  // Sport and league context — derived via player_team_assignments
  sport_key: string;           // e.g. 'NBA', 'NFL', 'MLB', 'NHL'
  league_id: string;           // e.g. 'nba', 'nfl'
  team_id: string;             // current team (player_team_assignments.is_current = true)
  team_display_name: string;

  // Position — not yet in players table (currently in provider_offers metadata)
  position: string | null;     // e.g. 'PG', 'SF', 'SP', 'QB' — requires enrichment

  // Traceability
  provider_participant_ids: string[];  // aliases from provider_entity_aliases
}
```

**Confirmed gaps:**
- `position` is not in the current `players` schema — it lives in `provider_offers.metadata` (SGO) and must be extracted during enrichment (see Section 5)
- `player_team_assignments` has time-bound records; current team is `is_current = true`

---

## 2. Stat History Shape

**Source of truth:** `GameLog` in `packages/domain/src/features/player-form.ts` (confirmed)

### 2a. Game-Level Log

```typescript
// Confirmed — packages/domain/src/features/player-form.ts
interface GameLog {
  game_date: string;        // ISO date
  minutes: number;
  stat_value: number;       // single target stat per log entry
  usage_rate?: number;      // 0–1 fraction of team possessions; optional
  started: boolean;

  // Extended fields needed for Research workspace (not yet in domain type)
  opponent_team_id?: string;
  home_away?: 'home' | 'away';
  game_result?: 'win' | 'loss';    // team result
  stat_type?: string;              // e.g. 'points', 'assists', 'strikeouts'
}
```

### 2b. Season Aggregate Shape

```typescript
interface PlayerSeasonAggregate {
  player_id: string;
  season: string;           // e.g. '2025-26'
  sport_key: string;
  stat_type: string;        // one aggregate per stat type
  games_played: number;
  games_started: number;
  season_average: number;
  season_total: number;
  minutes_average: number | null;
  usage_rate_average: number | null;
}
```

### 2c. Rolling Window Shape

```typescript
// Derived from PlayerFormFeatures — packages/domain/src/features/player-form.ts (confirmed)
interface PlayerRollingWindow {
  player_id: string;
  stat_type: string;
  window_size: number;          // number of games (e.g. 5, 10, 20)
  computed_at: string;          // ISO timestamp

  // Direct from PlayerFormFeatures (confirmed domain output)
  minutes_avg: number;
  minutes_trend: number;        // normalized slope [-1, +1]
  minutes_projection: number;
  stat_per_minute: number;
  stat_per_opportunity: number;
  stat_trend: number;           // normalized slope [-1, +1]
  player_base_volatility: number;
  consistency_score: number;    // [0, 1] — higher = more consistent
  games_sampled: number;
}
```

**Note:** `extractPlayerFormFeatures()` in `packages/domain` is the computation authority for rolling window fields. Research workspace consumes its output — it does not recompute.

---

## 3. Opponent / Matchup Context Shape

No confirmed existing schema. These are requirements only.

```typescript
interface OpponentMatchupContext {
  player_id: string;
  opponent_team_id: string;
  sport_key: string;
  stat_type: string;
  season: string;

  // Defense vs Position (DvP)
  dvp_rank: number | null;         // 1 = easiest, 30 = toughest (by games allowed)
  dvp_stat_average_allowed: number | null;  // avg of stat allowed to this position
  dvp_percentile: number | null;   // 0–100; >70 = favorable matchup

  // Trend
  dvp_last_5_allowed: number | null;       // recent DvP average (last 5 games)
  dvp_trend: 'improving' | 'worsening' | 'stable' | null;

  // Head-to-head history (same player vs same team)
  h2h_games: number;
  h2h_stat_average: number | null;
  h2h_stat_over_line_rate: number | null;  // hit rate vs line
}
```

**Data dependency:** DvP requires aggregating historical game-log data by opponent and player position. Not computable from current `provider_offers` alone — requires game-level stat data at depth. **Implementation blocked by SGO historical ingestion depth (UTV2-431).**

---

## 4. Similar-Player Candidate Input Shape

Similar-player matching is a Research workspace feature that surfaces comparable players for context. The input to a similarity computation is a player's feature profile.

```typescript
interface PlayerSimilarityProfile {
  player_id: string;
  sport_key: string;
  position: string | null;
  stat_type: string;

  // Features used for similarity (all from confirmed domain types)
  minutes_avg: number;
  minutes_uncertainty: number;
  stat_per_minute: number;
  stat_per_opportunity: number;
  consistency_score: number;     // [0, 1]
  player_base_volatility: number;

  // Scoring signal (from promotion pipeline)
  edge_avg: number | null;       // pick.metadata.promotionScores.edge, averaged over window
  trust_avg: number | null;      // pick.metadata.promotionScores.trust, averaged over window
}
```

**Algorithm selection is deferred.** The input shape above is sufficient for both cosine similarity and kNN approaches. Implementation requires a player population with computed rolling window profiles.

---

## 5. Player Enrichment Agent Input Fields (Readiness Item 5.3)

These are the fields the Research workspace will need from a future player enrichment agent. Defining them now prevents the agent from being built against a moving target.

```typescript
interface PlayerEnrichmentInput {
  player_id: string;           // canonical uuid from players table
  display_name: string;
  sport_key: string;
  team_id: string;

  // Identity enrichment — currently missing from players schema
  position: string | null;          // primary position (e.g. 'SG', '1B')
  jersey_number: string | null;

  // Provider linkage (required for stat ingestion)
  sgo_participant_id: string | null;        // from provider_entity_aliases
  odds_api_participant_id: string | null;   // from provider_entity_aliases

  // Signals to enrich
  season_averages: PlayerSeasonAggregate[];     // populated by enrichment agent
  recent_game_logs: GameLog[];                  // last 20 games, all stat types
}

// Enrichment agent output contract (stub — full spec requires UTV2-433)
interface PlayerEnrichmentOutput {
  player_id: string;
  enriched_at: string;          // ISO timestamp
  position: string | null;
  season_averages: PlayerSeasonAggregate[];
  recent_game_logs: GameLog[];
  enrichment_source: 'sgo' | 'manual';
  enrichment_confidence: 'high' | 'medium' | 'low';
}
```

**5.3 readiness gate:** The enrichment agent cannot run until:
1. SGO historical depth is sufficient (UTV2-431 — live data gate)
2. `provider_entity_aliases` population is complete for active players
3. `players.position` column is added (T2 migration, not part of this spec)

---

## 6. Implementation Sequence (deferred — for future tracking)

| Phase | Work | Gate |
|-------|------|------|
| P1 (unblocked) | `position` column on `players` table; provider alias population | None — T2 migration |
| P2 (blocked) | Game-log ingest from SGO historical data | UTV2-431 (live data) |
| P3 (blocked) | Season aggregate computation, DvP tables | P2 complete |
| P4 (blocked) | Player enrichment agent (`PlayerEnrichmentInput` → `PlayerEnrichmentOutput`) | P3 complete, UTV2-433 |
| P5 | Research workspace components consuming enriched data | P4 complete |

**This spec gates P1.** P2–P5 are ingestion-blocked and must not start without explicit PM approval.

---

## Confirmed Sources

All shapes above are grounded in the following confirmed repo artifacts:

| Shape | Source |
|-------|--------|
| `PlayerIdentity` | `public.players` (migration `202604020001`), `public.player_team_assignments` |
| `GameLog` | `packages/domain/src/features/player-form.ts` (exported type) |
| `PlayerFormFeatures` / `PlayerRollingWindow` | `packages/domain/src/features/player-form.ts` (`extractPlayerFormFeatures` output) |
| `PlayerSeasonAggregate` | Requirements-only; no current schema analog |
| `OpponentMatchupContext` | Requirements-only; no current schema analog |
| `PlayerSimilarityProfile` | Derived from `PlayerFormFeatures` + `picks.metadata.promotionScores` |
| `PlayerEnrichmentInput/Output` | Requirements-only; stubs confirmed against `provider_entity_aliases` pattern |
