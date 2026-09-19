# Research Workspace MVP Spec

**Issue:** UTV2-414
**Generated:** 2026-04-07
**Authority:** This document is the canonical MVP scope contract for the Research workspace. It feeds UTV2-415 (Research workspace implementation). Do not implement any Research module without consulting this spec and `CC_MODULE_DEPENDENCY_MAP.md`.

---

## Prerequisite Reading

This spec was derived from two upstream authority documents. All status classifications here are sourced directly from them:

- `docs/05_operations/CC_MODULE_DEPENDENCY_MAP.md` — canonical data reality as of 2026-04-07
- `docs/05_operations/COMMAND_CENTER_AUDIT.md` — existing operator-web and command-center surface inventory

Do not update module statuses in this document without first updating `CC_MODULE_DEPENDENCY_MAP.md`.

---

## Workspace Overview

The Research workspace does not exist in any form today (0% coverage per audit). No prop explorer, player card, matchup card, or line-shopper is implemented in `apps/command-center` or surfaced from `apps/operator-web`. The `participants` endpoint (`GET /api/operator/participants`) exists in operator-web but is connected to no command-center page.

This spec defines what can ship in v1 and what cannot, and why.

---

## Module 1: Prop Explorer

**Status:** Shippable now

**Data source:**
- `provider_offers` (329k rows, 2026-01-05 to 2026-04-04, live and actively ingested)
- Queryable by `sport`, `market_type`, `bookmaker_key`, `event_date`, `player_name`

**Scope — what it shows:**
- Browseable list of available props per sport/market/date
- Per-row: player name, market type, line value, over/under odds, bookmaker key, offer timestamp
- Filter controls: sport selector, market type selector, date range, bookmaker filter
- Sort by odds sharpness (Pinnacle as reference) or line value

**Scope — what it does NOT show:**
- Historical prop lines from before the ingestor start date (no backfill)
- Player stat context or hit rates (those belong to Module 5, which is shell only)
- Cross-sport comparative views
- Model-generated prop predictions (no model ops running)

**Source-of-truth rule:**
- `provider_offers.line` = canonical line value
- `provider_offers.bookmaker_key` = canonical bookmaker identifier (Pinnacle/DK/FD/BetMGM)
- `provider_offers.updated_at` = freshness timestamp

**Overlap check:**
- No existing command-center page covers prop browsing. The `GET /api/operator/pick-search` endpoint covers picks, not market offers. No duplication.
- The operator-web `participants` endpoint is adjacent but covers identity, not offers.

---

## Module 2: Player Card

This module has two sub-components with different statuses. They must be implemented separately and presented as distinct UI states.

### 2a: Player Identity (shippable)

**Status:** Shippable now

**Data source:**
- `players` (populated via ingestor)
- `player_team_assignments`
- `teams`

**Scope — what it shows:**
- Player name, position, current team assignment, sport
- Team name and abbreviation
- Jersey number if available in the `players` table

**Scope — what it does NOT show:**
- Season statistics, game logs, or box score history — no such table exists in DB
- Historical hit rates derived from external sources
- Injury status (no injury data source is wired)

**Source-of-truth rule:**
- `players.full_name` = canonical display name
- `player_team_assignments` = canonical current team (check `is_current = true` or latest effective date)
- `teams.abbreviation` = canonical team identifier

**Overlap check:**
- `GET /api/operator/participants` in operator-web returns players/teams with sport/type/search filters. This endpoint exists but is not surfaced in any CC page. The Research workspace should consume this endpoint rather than creating a new one.
- No duplication with any existing CC page.

### 2b: Player Historical Stats (blocked)

**Status:** Blocked — historical backfill

**Blocker:** No player box score history table exists in the DB. `settlement_records` contains graded pick outcomes but cannot substitute for external stat history — volume is too low and coverage is limited to submitted picks only.

**What resolves it:** A new ingest pipeline that populates a `player_game_stats` or equivalent table with historical box score data. This does not exist and is not planned in the current milestone.

**v1 behavior:** The player card must render a clear "Historical stats not yet available" placeholder in the stats section. Do not render empty tables or zeros. Do not imply data is absent due to a bug.

---

## Module 3: Matchup Card

This module has two sub-components with different statuses.

### 3a: Event Identity (shippable)

**Status:** Shippable now

**Data source:**
- `events` (SGO-sourced game schedule, populated via ingestor)
- `event_participants`
- `teams`

**Scope — what it shows:**
- Game date, time, sport, league
- Home and away team names and abbreviations
- Venue if available in `events`
- Current available lines from `provider_offers` for this event (link to prop explorer filtered by event)

**Scope — what it does NOT show:**
- Head-to-head historical records
- Team season statistics or comparative metrics
- Injury reports or roster status
- Betting trends from external sources (ATS record, over/under record)

**Source-of-truth rule:**
- `events.id` = canonical event identifier (SGO event ID)
- `events.commence_time` = canonical game start time
- `event_participants` = canonical team-to-event mapping
- `teams.full_name` = canonical display name

**Overlap check:**
- No existing CC page surfaces event/matchup context. The operator-web dashboard shows game exposure counts in `boardExposure` (part of snapshot) but does not render matchup cards. No duplication.

### 3b: Matchup Comparative Stats (blocked)

**Status:** Blocked — historical backfill

**Blocker:** No head-to-head stat table exists. No team-level season aggregate table exists. `provider_offers` provides line context but not comparative team performance metrics.

**What resolves it:** Same box score ingest pipeline required for Module 2b.

**v1 behavior:** The matchup card renders event identity only. The comparative stats section shows a "Season stats not yet available" placeholder. Do not render empty stat tables.

---

## Module 4: Trend/Split Filters

**Status:** Blocked — historical backfill

**Data source (if unblocked):** Would require a `player_game_stats` table with splits by home/away, opponent, game-time conditions, and recency windows. This table does not exist.

**What exists now:** `settlement_records` contains graded pick outcomes (win/loss/push/void) per pick. This enables pick-outcome-based filtering (e.g., "show me picks where this player's over hit in the last 10 graded picks") but this is NOT equivalent to an external stat split view. Coverage is limited to submitted picks only, not the full market.

**What resolves it:** Historical box score ingest pipeline. No alternative path exists.

**v1 behavior:** This module must NOT ship in v1. It must be represented in the nav/sidebar as a disabled item with a "Coming soon — requires stat history ingest" label. Do not ship a partial version using only pick outcomes and label it as a trend/split filter — that would misrepresent the capability.

**Overlap check:**
- No existing CC page attempts trend/split filtering. No duplication risk.

---

## Module 5: Hit Rate / Avg / Median

**Status:** Shell only — volume-limited

**Data source:**
- `settlement_records` (graded pick outcomes)
- `picks` (market type, player reference, sport)

**Scope — what it CAN show (shell):**
- Win/loss/push counts per player and market type, derived from graded `settlement_records`
- Simple hit rate (wins / (wins + losses)) per player/market segment
- Average line value and median odds at submission time for graded picks

**Scope — what it CANNOT show in v1:**
- Statistical significance indicators (insufficient volume — needs 100+ graded picks per segment per dependency map)
- Confidence intervals or trend lines
- Splits by home/away, opponent, or game context (blocked — same as Module 4)
- External hit rates or industry averages for comparison

**Source-of-truth rule:**
- `settlement_records.outcome` = canonical grading result (`win` / `loss` / `push` / `void`)
- `settlement_records.clv_at_close` = CLV value if present, but NOT yet proven end-to-end (UTV2-335 open — do not surface CLV in this module)
- `picks.market_type_id` = canonical market type FK

**Volume gate:** The dependency map requires 100+ graded picks per segment for statistical significance. Until that threshold is reached, this module must display a "Insufficient data for this segment (N picks graded)" message rather than potentially misleading hit rate percentages. The N count must be shown.

**v1 behavior:** Ship the shell. Compute and show hit rates. Always show the sample size (N). Show the volume warning when N < 100. Never suppress the N count.

**Overlap check:**
- `/performance` page in command-center shows capper leaderboard and time-window stats. That is a capper-level ROI view for the Intelligence workspace. Hit rate per prop/player is a Research-level tool. No duplication.
- `/intelligence` page shows score bands and score-outcome correlation. Different concept. No duplication.

---

## Module 6: Line-Shopper

**Status:** Shippable now

**Data source:**
- `provider_offers` filtered by `bookmaker_key` (Pinnacle, DraftKings, FanDuel, BetMGM rows all present)
- `provider_offers.updated_at` for freshness

**Scope — what it shows:**
- For a selected player prop or game line: side-by-side view of current line and odds across all available bookmakers
- Bookmakers shown: Pinnacle, DraftKings, FanDuel, BetMGM (whatever `bookmaker_key` values are present for the selected market in `provider_offers`)
- Opening line vs current line comparison where both timestamps are available in `provider_offers`
- Best available line highlight per side (over/under)

**Scope — what it does NOT show:**
- Line movement history beyond what is in `provider_offers` (no time-series line movement table)
- Sharp money indicators or line movement causality analysis
- Books not present in `provider_offers` (no manual book addition)
- Closing line value against settlement (that is CLV, blocked by UTV2-335, belongs to Intelligence workspace when unblocked)

**Source-of-truth rule:**
- `provider_offers.line` = canonical line per bookmaker
- `provider_offers.over_odds` / `provider_offers.under_odds` = canonical odds per side
- `provider_offers.bookmaker_key` = canonical bookmaker identifier
- `provider_offers.updated_at` = canonical freshness timestamp
- Pinnacle (`bookmaker_key = 'pinnacle'`) is the sharp reference book — display it first and use it as the reference for line comparison

**Approval/promotion note:** Line-shopper is a pure research tool. It shows market data only. It has no relationship to pick approval or promotion state. These are separate concepts and must not be conflated in UX copy or tooltips.

**Overlap check:**
- No existing CC page surfaces a line-shopper or multi-book line comparison. `boardExposure` in the snapshot shows pick count exposure, not market line comparison. No duplication.
- The operator-web `GET /api/operator/participants` is unrelated. No duplication.

---

## Summary Table

| Module | Status | Canonical Source | v1 Deliverable |
|--------|--------|-----------------|---------------|
| 1. Prop explorer | Shippable now | `provider_offers` | Full browse + filter UI |
| 2a. Player card — identity | Shippable now | `players`, `player_team_assignments`, `teams` | Identity layer rendered |
| 2b. Player card — historical stats | Blocked: historical backfill | No table exists | "Not yet available" placeholder |
| 3a. Matchup card — event identity | Shippable now | `events`, `event_participants`, `teams` | Event identity card |
| 3b. Matchup card — comparative stats | Blocked: historical backfill | No table exists | "Not yet available" placeholder |
| 4. Trend/split filters | Blocked: historical backfill | No split table exists | Disabled nav item, "Coming soon" label |
| 5. Hit rate / avg / median | Shell only (volume-limited) | `settlement_records` + `picks` | Shell with N count + volume warning at N < 100 |
| 6. Line-shopper | Shippable now | `provider_offers` (multi-bookmaker) | Multi-book side-by-side view |

---

## What Was Scoped Out and Why

### Historical stats (player and matchup comparative) — Modules 2b and 3b
No `player_game_stats` or equivalent box score history table exists in the DB. This is not a schema gap that can be patched — it requires a new ingest pipeline sourcing historical game-level player statistics. Speccing these as v1 shippable would require hallucinating a data source. Both are marked blocked with explicit placeholder behavior.

### Trend/split filters — Module 4
Directly blocked by the same historical backfill gap. `settlement_records` could theoretically power a picks-only outcome filter, but this would be a materially different and narrower capability than what "trend/split filters" implies (home/away, opponent matchup, game-time conditions, last-N-games splits). Shipping a degraded version under the trend/split label would misrepresent the feature. Scoped out entirely.

### CLV in hit rate module — Module 5
`settlement_records.clv_at_close` column exists in schema but valid values are not proven end-to-end (UTV2-335 is open, MI-M5 gate). CLV must not be surfaced in any Research workspace module until UTV2-335 closes and CLV values are confirmed valid.

### Cross-sport comparative views
No cross-sport stat table exists. Out of scope for v1 per dependency map explicit guidance.

### Injury/roster status
No injury data source is wired in the ingestor or any DB table. Out of scope — not even a blocked status, simply not a current data reality.

### External hit rates / industry benchmarks
No external hit rate source is ingested. Only pick-derived outcomes from `settlement_records` are available.

---

## New Operator-Web Endpoints Required for v1

The following endpoints do not yet exist or need expansion before Research workspace implementation can begin:

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `GET /api/operator/participants` | Player/team identity; already exists in operator-web | Exists — not yet consumed by CC. Mark as `expand` target. |
| `GET /api/operator/prop-offers` | Browse `provider_offers` by sport/market/date/bookmaker | Missing — new endpoint required |
| `GET /api/operator/line-shopper` | Multi-book line comparison for a given player/market | Missing — new endpoint required |
| `GET /api/operator/hit-rates` | Computed win/loss/push rates from `settlement_records` + picks | Missing — new endpoint required |
| `GET /api/operator/events/:id` | Single event detail with participants and current lines | Missing or extend existing — verify before creating |

These are operator-web read endpoints only. They must not write to the DB. Approval and promotion state must not be exposed through Research workspace endpoints.

---

## Implementation Dependency Order

Ship in this order to avoid building UI against missing endpoints:

1. Operator-web endpoint additions (listed above) — unblocks all UI work
2. Prop explorer — simplest query, most data available
3. Line-shopper — depends on same `provider_offers` table as prop explorer
4. Player card (identity layer only) — depends on `participants` endpoint expansion
5. Matchup card (event identity only) — depends on events endpoint
6. Hit rate / avg / median shell — depends on `hit-rates` endpoint; ship with volume warning active

Modules 2b, 3b, and 4 are explicitly deferred — do not implement placeholders that suggest near-term availability unless the box score ingest pipeline has been scoped and committed.
