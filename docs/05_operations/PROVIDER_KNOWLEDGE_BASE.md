# Provider Knowledge Base

**Status:** Living document — update whenever new API capabilities, limits, or patterns are discovered.  
**Authority:** T1 operational reference. Owned by PM (A Griffin).  
**Purpose:** Prevent rediscovery. Every unlock, constraint, and integration pattern goes here so future sessions start from knowledge, not from scratch.

---

## Table of Contents

1. [SGO (Sports Game Odds)](#1-sgo-sports-game-odds)
   - [1.13 SGO MCP Server](#113-sgo-mcp-server--in-session-live-api-access)
2. [The Odds API](#2-the-odds-api)
3. [Integration Patterns](#3-integration-patterns)
4. [Discovered Unlocks Log](#4-discovered-unlocks-log)

---

## 1. SGO (Sports Game Odds)

### 1.1 Plan Tiers — Critical

| Plan | Price | Objects/month | Pinnacle | Notes |
|------|-------|--------------|----------|-------|
| Amateur | Free | 2,500 | No | Dev/sandbox only |
| Rookie | $99/mo | 100,000 | **No** | 77 bookmakers — Pinnacle excluded |
| Pro | $299–499/mo | Unlimited | **Yes** | 82 bookmakers incl. Pinnacle + Circa |
| AllStar | Custom | Unlimited | Yes | Adds WebSocket streams |

**Locked decision (2026-04-04):** Rookie is ruled out permanently — no Pinnacle = no valid CLV or real edge. Dev uses Odds API; production flips to SGO Pro. See `PROVIDER_DATA_DECISION_RECORD.md` Amendment A.

### 1.2 Credit / Pricing Model

- **Charged per event (object) returned, not per market or bookmaker**
- 10 events with 250 markets and 50 bookmakers each = 10 credits
- Competing APIs would charge 125,000 credits for the same data
- SGO Pro: unlimited objects (no budget concern)

Hard caps on all plans:
- 50,000 requests/hour
- 300,000 objects/hour
- 7,000,000 objects/day

Check usage: `GET /v2/account/usage` — returns `rateLimits` object with per-second through per-month breakdowns.

### 1.3 Base URL and Auth

```
https://api.sportsgameodds.com/v2/
```

Auth: `x-api-key` header OR `?apiKey=` query param (both work). Header is preferred.

### 1.4 The `oddID` Format

Every market is identified by a structured key:

```
{statID}-{statEntityID}-{periodID}-{betTypeID}-{sideID}
```

| Component | Examples |
|---|---|
| `statID` | `points`, `assists`, `rebounds`, `batting-hits`, `pitching-strikeouts` |
| `statEntityID` | `home`, `away`, `all`, or a playerID (e.g. `JALEN_BRUNSON_1_NBA`) |
| `periodID` | `game`, `reg`, `1h`, `1q`, `2h` |
| `betTypeID` | `ml` (moneyline), `sp` (spread), `ou` (over/under), `ml3way`, `yn` (yes/no) |
| `sideID` | `home`, `away`, `over`, `under`, `yes`, `no`, `home+draw`, `away+draw` |

Examples:
- `points-home-game-ml-home` = moneyline home team win, full game
- `points-all-game-ou-over` = game total over, full game
- `points-JALEN_BRUNSON_1_NBA-game-ou-over` = Brunson points over, full game
- `points-home-game-sp-home` = spread home team, full game

### 1.5 Key Endpoints

#### `GET /v2/events`

Primary data endpoint. Returns events with odds, results, players, teams, status.

**Critical query parameters:**

| Parameter | Value | Effect |
|---|---|---|
| `leagueID` | `NBA,NFL,MLB,NHL` | Filter by league (comma-separated) |
| `finalized` | `true` | Only finalized events — use for grading |
| `ended` | `true` | Events whose clock has ended (pre-finalization) |
| `oddsAvailable` | `true` | Only events with open markets |
| `oddID` | `points-home-game-ml-home` | Filter to specific markets (reduces payload) |
| `bookmakerID` | `pinnacle` | Surgical: only Pinnacle data |
| `includeOpenCloseOdds` | `true` | Adds open/close per bookmaker (see §1.7) |
| `includeOpposingOdds` | `true` | Auto-include other side of each oddID |
| `includeAltLines` | `true` | Alternate spread/OU lines (large payload) |
| `expandResults` | `true` | Full raw stat values in results object |
| `startsAfter` | ISO 8601 | Date range filter |
| `startsBefore` | ISO 8601 | Date range filter |
| `limit` | 1–300 | Default: 10. Max: ~100 for odds queries |
| `cursor` | from `nextCursor` | Pagination token |

**Pagination:** Default limit 10. Use `nextCursor` from response. A 404 with cursor = end of results. Do not change other params between cursor requests.

**Plan restriction notice:** If plan limits data, response includes:
```json
{ "notice": "Response is missing 3 events and 15 bookmaker odds. Upgrade your API key..." }
```
Monitor this field in production.

#### `GET /v2/account/usage`

Returns current usage across all rate limit windows. Shape:
```json
{
  "rateLimits": {
    "perSecond": { "maxRequests": ..., "maxEntities": ..., "currentRequests": ..., "currentEntities": ... },
    "perMinute": { ... },
    "perHour": { ... },
    "perDay": { ... },
    "perMonth": { ... }
  }
}
```

### 1.6 Odds Object — Key Fields

Each `odds.<oddID>` object contains:

| Field | Always present | Description |
|---|---|---|
| `fairOdds` | Yes | Current vig-free consensus (7-step linear regression devig) |
| `bookOdds` | Yes | Current consensus with vig included |
| `openFairOdds` | Yes | Opening fair odds — **use for CLV opening line** |
| `openBookOdds` | Yes | Opening book odds |
| `fairSpread` / `bookSpread` | Spread only | Fair/book spread line |
| `fairOverUnder` / `bookOverUnder` | OU only | Fair/book O/U line |
| `openFairSpread` / `openBookSpread` | Spread only | Opening fair/book spread |
| `openFairOverUnder` / `openBookOverUnder` | OU only | Opening fair/book O/U |
| `scoringSupported` | Yes | **Whether SGO will provide a score for this market** |
| `score` | When available | **The market-specific outcome value — use for grading** |
| `byBookmaker` | Yes | Per-bookmaker breakdown |
| `started` / `ended` / `cancelled` | Yes | Market lifecycle flags |

**The `fairOdds` / `bookOdds` distinction matters:**
- `fairOdds` = devigged true probability → use for edge calculation
- `bookOdds` = consensus market price with vig → use for CLV benchmark
- `openFairOdds` = opening fair odds → use as CLV opening baseline (available without extra params)

### 1.7 Auto-Grading — The Correct Approach

**SGO support confirmed (2026-04-04):**

> "To determine outcomes for a given odds market we recommend looking at the 'score' field on that odds market. That can be found at `odds.<oddID>.score`. You can also see whether we will end up providing scores on a given odds market by checking the `scoringSupported` field."

> "The results object holds the 'raw' score data which isn't as helpful when scoring odds markets as the dedicated score field is."

> "We typically recommend waiting until the event is finalized (`status.finalized == true`) to finalize your scores. You can certainly start scoring things as soon as the event is ended (`status.ended == true`) if you want, but by waiting until it's finalized (usually up to an hour after it ends), that gives our system time to perform additional verifications and reduce the chances of a later stat correction."

**Correct grading flow:**
```
1. Poll for events with status.finalized=true (or status.ended=true for faster settlement)
2. For each event, check odds.<oddID>.scoringSupported=true
3. Read odds.<oddID>.score → this is the market-specific result value
4. Compare score to pick.line → win/loss/push
5. Do NOT use event.results.game for grading (raw unverified data)
```

This works for ALL market types: moneylines, spreads, totals, player props.

**Timing guidance:**
- `status.ended=true` → game clock stopped, can start grading (may have rare stat corrections later)
- `status.finalized=true` → SGO verified, safe to grade (usually ≤1hr after ended)
- Production default: wait for `finalized=true`
- Speed mode: grade on `ended=true`, re-check on `finalized=true` for corrections

> **CRITICAL — `status.completed` is not a reliable SGO field.**
> SGO does not consistently set `status.completed`. Playoff games and some event types return
> `status.finalized=true` without ever setting `status.completed=true`. Never gate on
> `status.completed` — use `status.finalized` as the sole authoritative completion signal.
> Code in `mapSGOStatus` and `extractEventResult` must check `finalized` only.
> (Confirmed via investigation 2026-04-18: 22 playoff picks unsettled because events were never
> marked `completed` in DB. Root cause: `status.completed && status.finalized` guard — fixed to
> `status.finalized` only.)

### 1.8 Open/Close Odds — CLV and Line Movement

**Without extra params** (always available):
- `odds.<oddID>.openFairOdds` — opening vig-free line (perfect for CLV)
- `odds.<oddID>.openBookOdds` — opening consensus line with vig

**With `includeOpenCloseOdds=true`** (per bookmaker):
```json
"byBookmaker": {
  "pinnacle": {
    "odds": "-112",
    "openOdds": "-108",
    "closeOdds": "-112",
    "openSpread": "-1.5",
    "closeSpread": "-2.5",
    "openOverUnder": "223.0",
    "closeOverUnder": "224.5",
    "available": true,
    "lastUpdatedAt": "..."
  }
}
```

- `openOdds` = when line was first available at that specific book
- `closeOdds` = at event start time at that specific book
- These are per-bookmaker, not consensus

**Use cases:**
- CLV = compare pick submission odds to `closeOdds` at Pinnacle
- Line movement detection = `openOdds` vs current vs `closeOdds`
- Sharp vs. square divergence = Pinnacle `openOdds` vs `fanduel.openOdds`

### 1.9 Surgical Data Fetching — Efficiency Patterns

```
# Only Pinnacle odds for CLV
?bookmakerID=pinnacle&oddID=points-home-game-ml-home,points-all-game-ou-over

# Only finalized events for grading
?finalized=true&startsAfter=2026-04-03T00:00:00Z&startsBefore=2026-04-04T23:59:59Z

# Opening/closing lines for CLV analysis
?includeOpenCloseOdds=true&bookmakerID=pinnacle&finalized=true

# Upcoming events with odds available only
?oddsAvailable=true&started=false

# Live in-play events
?live=true
```

### 1.10 `byBookmaker` Structure — Per-Bookmaker Access

```json
"byBookmaker": {
  "pinnacle": { "odds": "+133", "lastUpdatedAt": "...", "available": true },
  "draftkings": { "odds": "-112", "overUnder": "224.5", "available": true, "deeplink": "https://..." },
  "fanduel": { "odds": "-118", "available": true }
}
```

**Bookmaker ID slugs:** `pinnacle`, `draftkings`, `fanduel`, `betmgm`, `caesars`, `bet365`, `betparx`, and 75+ more on Pro plan.

Note: `deeplink` field provides direct bet link to each book — useful for Discord embeds.

### 1.11 The `results` Object — When to Use It

The `results` object on an event contains raw stat values (final scores, player stats). Per SGO support, this is **not** the recommended approach for grading odds markets. Use cases where `results` IS appropriate:
- Displaying final scores in embeds (e.g., "LAL 112, BOS 108")
- Raw stat lookups not tied to a specific odds market
- Box score data for Discord posts

Use `odds.<oddID>.score` for grading. Use `event.results` for display.

### 1.13 SGO MCP Server — In-Session Live API Access

**Package:** `sports-odds-api-mcp` (npm)  
**Config:** `.mcp.json` at repo root (gitignored). Do not commit — contains API key.  
**Env var:** `SPORTS_ODDS_API_KEY_HEADER`

```json
{
  "mcpServers": {
    "sports-game-odds": {
      "command": "npx",
      "args": ["-y", "sports-odds-api-mcp@latest"],
      "env": { "SPORTS_ODDS_API_KEY_HEADER": "<your-api-key>" }
    }
  }
}
```

**Available MCP tools:**

| Tool | Description |
|---|---|
| `get_sports` | Enumerate all sport IDs (e.g. `BASKETBALL`, `HOCKEY`, `FOOTBALL`) |
| `get_leagues` | All league IDs per sport (e.g. `NBA`, `NHL`, `NFL`) |
| `get_stats` | All statIDs per sport — use before writing normalizer/alias code |
| `get_teams` | Teams per league — use to validate `provider_entity_aliases` |
| `get_players` | Players per league — use to validate player aliases |
| `get_events` | Full event data with odds, participants, results |
| `get_usage_account` | Current rate limit consumption across all windows |
| `search_docs` | Search SGO API documentation in-context |
| `events_stream` | Live event stream (WebSocket — AllStar plan only) |

**Important:** SGO sport IDs are NOT the same as league IDs. Always call `get_sports` first to confirm. Correct IDs: `BASKETBALL`, `HOCKEY`, `FOOTBALL`, `BASEBALL`. NOT `NBA`, `NHL`, `NFL`.

#### High-Value Use Cases

**1. Live market key verification (most impactful)**  
Before writing `provider_market_aliases`, call `get_events` with a live event to confirm exact oddID format. Example: `passing_yards-JALEN_GREEN_1_NFL-game-ou-over` → normalizes to `passing_yards-all-game-ou`. Zero guesswork vs. multiple rounds of DB sampling.

```
get_events(sportID: "FOOTBALL", leagueID: "NFL", oddsAvailable: true, limit: 1)
→ inspect event.odds keys → derive normalized form → write alias
```

**2. New sport/stat onboarding**  
Before writing normalizer code for a new sport, call `get_stats` to enumerate ALL statIDs. Prevents missing mappings or misspelled stat keys.

**3. Usage monitoring in-session**  
Call `get_usage_account` directly instead of running a script. Check consumption before expensive batch operations.

**4. Entity validation**  
Call `get_players(leagueID: "NBA")` or `get_teams(leagueID: "NHL")` to confirm SGO's canonical entity IDs before writing `provider_entity_aliases`. Prevents silent mismatches.

**5. Grading debugging**  
Call `get_events(eventID: "<id>", finalized: true)` and inspect `odds.<oddID>.score` and `scoringSupported` for a specific pick. Confirms grading data is present without running a script.

**6. Line movement investigation**  
Call `get_events` with `includeOpenCloseOdds: true` and `bookmakerID: "pinnacle"` to see opening vs. closing lines for any event. Direct alert-agent calibration.

**7. Documentation search in-context**  
Call `search_docs` for any SGO API question during implementation. Faster than switching browser tabs.

**8. Pre-flight alias validation**  
Before a DB migration, verify the alias key you're about to insert actually matches live SGO offer keys. Prevents deploying aliases that never match.

**Proven efficiency gain (UTV2-388, 2026-04-05):** NHL and NFL player prop aliases written correctly in one pass using `get_events` MCP calls. Previous approach required multiple DB samples + guessing + correction cycles.

---

### 1.12 SGO Normalizer — Known Behavior (Unit Talk V2)

In our ingestor (`apps/ingestor/src/`):

**Market key format in our system:** After normalization, market keys become:
- `points-all-game-ou` (prop over/under, entity replaced with `all`)
- `points-all-game-ml` (moneyline, entity replaced with `all`)
- Participant ID stored separately in `providerParticipantId`

**Fixed 2026-04-04:** `inferSide()` and `stripSideSuffix()` now handle `-home`/`-away` suffixes in addition to `-over`/`-under`. Before this fix, ALL moneyline and spread markets were silently dropped.

**Known gap (2026-04-04):** `results-resolver.ts` still uses `results.game` stat accumulation — needs rewrite to use `odds.<oddID>.score`. Tracked as next auto-settle work.

---

## 2. The Odds API

### 2.1 Plan and Pricing

- **Credit model:** `10 × markets × regions` per API call
- Each call returns ALL events for the requested sport at that timestamp
- Standard: 3 markets × 1 region = **30 credits per call**
- Full with player props: 4+ markets = 40+ credits/call

**100k credits budget analysis:**
| Use case | Credits | Duration |
|---|---|---|
| Historical backfill (3 markets, 4 sports, 6h intervals, 90 days) | ~43,200 | One-time |
| Live polling (MLB only, 15-min, 14h/day) | ~50,400/month | Ongoing |
| Spring overlap (3 sports, 15-min, 14h/day) | ~151,000/month | Exceeds 100k |
| Active game windows only (3 sports, ~6h/day) | ~54,000/month | Within 100k |

**Key:** 100k/month is sufficient if polling is scoped to active game windows. Full 14h/day across 3 sports in spring requires higher tier or 30-min intervals.

### 2.2 Pinnacle on Odds API

Pinnacle is included on **all standard paid plans**. This is the critical differentiator for dev — Odds API is the only way to get Pinnacle data without SGO Pro.

`providerKey` in our system: `odds-api:pinnacle`

### 2.3 Historical Endpoint

```
GET /v4/historical/sports/{sport_key}/odds/
```

Available from June 2020. 5-minute snapshots available from Sept 2022.

Query params: `date` (ISO 8601), `regions`, `markets`, `bookmakers`, `oddsFormat`

**Our implementation:** `fetchOddsApiHistorical()` in `apps/ingestor/src/odds-api-fetcher.ts` — exists but not scheduled. Called via `runHistoricalBackfill()`.

### 2.4 Credit Tracking

Response header: `x-requests-remaining` — tracked by our ingestor telemetry but not enforced. Monitor daily.

### 2.5 Role in Unit Talk Architecture

**Phase 1 (dev now):** Primary provider — Pinnacle + multi-book consensus + historical backfill  
**Phase 2 (production flip):** Optional supplement — SGO Pro replaces as primary  
**Settlement:** Not used — SGO is sole settlement authority  
**Player props:** Less structured than SGO (description matching required)

---

## 3. Integration Patterns

### 3.1 NormalizedProviderOffer — The Abstraction Layer

All provider data normalizes to `NormalizedProviderOffer` in `@unit-talk/contracts` before DB storage. Provider-specific code lives only in:
- `apps/ingestor/src/sgo-fetcher.ts` + `sgo-normalizer.ts`
- `apps/ingestor/src/odds-api-fetcher.ts`

Everything downstream (`real-edge-service`, `clv-service`, `alert-agent`, `promotion-service`) reads from `provider_offers` table using normalized shape. Adding or switching providers = write a new fetcher + normalizer only.

### 3.2 providerKey Convention

| Source | providerKey format |
|---|---|
| SGO (current) | `sgo` |
| Odds API — Pinnacle | `odds-api:pinnacle` |
| Odds API — DraftKings | `odds-api:draftkings` |
| Odds API — FanDuel | `odds-api:fanduel` |
| Future: SGO per-bookmaker | `sgo:pinnacle`, `sgo:draftkings` |

### 3.3 CLV Computation Pattern

Current (Odds API primary):
1. At submission: record `provider_offers` row with `isOpening=true` for Pinnacle
2. At settlement: find most recent Pinnacle row before game start (`isClosing=true`)
3. CLV = (submission odds implied prob − closing odds implied prob) / closing odds implied prob

Future (SGO Pro primary):
1. At settlement: fetch `odds.<oddID>.openFairOdds` and `closeOdds` from SGO directly
2. CLV = same formula using SGO's pre-computed values
3. Eliminates need for Odds API entirely for CLV

### 3.4 Edge Source Priority Chain

`real-edge-service.ts` priority:
1. `odds-api:pinnacle` → `real-edge` (strongest)
2. Multi-book consensus (≥2 books) → `consensus-edge`
3. `sgo` fairOdds → `sgo-edge`
4. Confidence-delta → `confidence-delta` (fallback, not market edge)

Under SGO Pro, step 1 becomes `sgo:pinnacle` (after byBookmaker capture is built).

### 3.5 Auto-Settle Pattern (correct approach — 2026-04-04)

```typescript
// Correct: use odds.<oddID>.score
const event = // fetched with finalized=true
const oddId = buildOddId(pick); // e.g. "points-PLAYER-game-ou-over"
const marketOdds = event.odds[oddId];

if (!marketOdds?.scoringSupported) {
  // skip — SGO can't score this market
}

const score = marketOdds.score; // the verified outcome value
const result = score > pick.line ? 'win' : score < pick.line ? 'loss' : 'push';

// Wrong (current): event.results.game stat accumulation
```

### 3.6 Backfill Pattern

`runHistoricalBackfill()` in `apps/ingestor/src/historical-backfill.ts`:
- Iterates dates day-by-day between `startDate` and `endDate`
- Calls `ingestLeague` per day per league with `startsAfter`/`startsBefore` bounds
- Uses same SGO API key as live ingest — just different date filters

No separate historical endpoint on SGO — just date-range filtering on `/v2/events`.

### 3.7 SGO Consensus Data Policy — Approved and Prohibited Uses

**Status:** Locked policy (2026-04-06). PM-owned. Do not relax without explicit approval.

#### What SGO provides

SGO exposes three distinct categories of odds data. Each has a defined role. They are not interchangeable.

| Category | SGO fields | What it represents |
|---|---|---|
| Current consensus | `fairOdds`, `bookOdds` | Live vig-free / with-vig aggregate across all available books at snapshot time |
| Opening consensus | `openFairOdds`, `openBookOdds` | Consensus at time market first opened — always available, no extra params required |
| Per-bookmaker open/close | `byBookmaker.pinnacle.openOdds`, `.closeOdds` | Pinnacle-specific opening and closing line — requires `includeOpenCloseOdds=true` |

Consensus fields (`fairOdds`, `bookOdds`, `openFairOdds`, `openBookOdds`) are aggregated across books. They are not Pinnacle-specific.

#### Approved uses for consensus / fair-line data

- **Operator reference** — displaying current market price, fair price, and opening price in operator dashboard, pick detail, and recap displays
- **Intelligence overlays** — line movement detection (`openFairOdds` vs. current `fairOdds`), sharp-vs-square divergence indicators, and alert-agent calibration
- **Current market benchmark** — `bookOdds` stored in `provider_offers` as a secondary reference data point at pick submission time
- **Edge calculation fallback** — `fairOdds` may be used in the `sgo-edge` tier (tier 3 in `real-edge-service` priority chain) when Pinnacle-specific data is unavailable
- **Opening line display** — `openFairOdds` as a labeled "consensus opening" data point for analytics overlays, explicitly not presented as Pinnacle opening

#### Prohibited uses — consensus data must NOT be used for

1. **CLV closing-line proof.** `fairOdds`, `bookOdds`, `openFairOdds`, and `openBookOdds` are not Pinnacle prices and are not closing-line proof. They must not be stored or displayed as CLV proof for settled picks.

2. **Replacing the `provider_offers` time-proximity lookup.** The canonical CLV lookup in `clv-service.ts` is `findClosingLine()` — a DB query against stored `provider_offers` rows using `snapshot_at <= starts_at`. Substituting a live `fairOdds` fetch at settlement time is not equivalent: the market may have moved post-game-start and the value is not reproducible.

3. **Populating `settlement_records.payload.clv`.** The `CLVResult` object in settlement payload must derive from `findClosingLine()` against stored rows, not from a runtime SGO consensus field.

4. **Claiming Pinnacle-specific closing line.** `openFairOdds` is not Pinnacle. `fairOdds` is not Pinnacle. Only `byBookmaker.pinnacle.closeOdds` (fetched with `includeOpenCloseOdds=true`) or a stored `sgo:pinnacle`-keyed `provider_offers` row constitutes a Pinnacle closing line.

5. **Bypassing the `provider_offers` storage layer.** No runtime service may fetch SGO consensus directly at settlement time as a shortcut. All CLV data must transit through the DB layer so it is auditable and reproducible.

#### Current CLV implementation status

The CLV wiring (`clv-service.ts`, `findClosingLine()`, `settlement_records.payload.clv`) is complete and uses time-proximity against stored `provider_offers` rows (see T1 CLV contract, closed 2026-03-26). The `providerKey` for these rows is `sgo` (consensus), not `sgo:pinnacle` (per-bookmaker).

True Pinnacle-specific CLV requires:
1. `includeOpenCloseOdds=true` on SGO fetches
2. `byBookmaker` capture stored as separate `provider_offers` rows with `providerKey: 'sgo:pinnacle'`
3. `findClosingLine()` scoped to `sgo:pinnacle` rows

This path is **not yet built** (deferred per CLV contract §10). Until it is, CLV values in `settlement_records` derive from SGO consensus time-proximity and must be labeled accordingly in any operator display or public-facing output.

#### Key invariants (must never be violated)

- Consensus ≠ proof
- `openFairOdds` ≠ Pinnacle opening line
- `fairOdds` at settlement time ≠ closing line
- CLV proof requires a stored row with a verifiable `snapshot_at` timestamp

---

## 4. Discovered Unlocks Log

Chronological record of capabilities discovered. Each entry = something that changes what we can build.

---

### 2026-04-04: SGO `odds.<oddID>.score` for grading

**Source:** Direct SGO support response  
**What it unlocks:** Auto-settle for ALL market types (ML, spread, totals, props). Current approach (`results.game` stat accumulation) only works for player props and is the wrong field per SGO.  
**Action required:** Rewrite `results-resolver.ts` to use `score` field; update `grading-service.ts`.  
**Files:** `apps/ingestor/src/results-resolver.ts`, `apps/api/src/grading-service.ts`

---

### 2026-04-04: `openFairOdds` / `openBookOdds` always available

**Source:** SGO getEvents endpoint docs  
**What it unlocks:** Opening line for CLV without extra API parameters or Odds API dependency. `odds.<oddID>.openFairOdds` is the vig-free opening benchmark available on every event response.  
**Action required:** Store `openFairOdds` in `provider_offers` or use it directly in CLV service. Eliminates `isOpening` tracking dependency on Odds API.  
**Files:** `apps/ingestor/src/sgo-fetcher.ts`, `apps/api/src/clv-service.ts`

---

### 2026-04-04: `includeOpenCloseOdds=true` — per-bookmaker open/close

**Source:** SGO odds data type docs  
**What it unlocks:** Pinnacle-specific opening and closing line per market. `byBookmaker.pinnacle.openOdds` and `closeOdds`. Enables Pinnacle CLV without Odds API, and sharp vs. square divergence tracking.  
**Action required:** Add `includeOpenCloseOdds=true` to SGO Pro fetches; store per-bookmaker offers (byBookmaker capture).  
**Files:** `apps/ingestor/src/sgo-fetcher.ts`

---

### 2026-04-04: `bookmakerID` filter — surgical Pinnacle fetching

**Source:** SGO getEvents endpoint docs  
**What it unlocks:** `?bookmakerID=pinnacle` returns only Pinnacle data. Efficient for CLV and edge computation without fetching all 82 books.  
**Action required:** Use targeted `bookmakerID=pinnacle` fetches in real-edge and CLV paths.  
**Files:** `apps/ingestor/src/sgo-fetcher.ts`, `apps/ingestor/src/ingest-league.ts`

---

### 2026-04-04: `scoringSupported` field — know before trying to grade

**Source:** SGO getEvents endpoint docs + support  
**What it unlocks:** Each `odds.<oddID>` has `scoringSupported: boolean`. Check this before attempting to grade — if false, SGO won't provide a score for that market. Replaces our brittle `inferSelectionSide()` logic.  
**Action required:** Gate grading attempts on `scoringSupported=true`.  
**Files:** `apps/api/src/grading-service.ts`

---

### 2026-04-04: SGO `-home`/`-away` side suffixes fixed

**Source:** Code audit + test verification  
**What it unlocks:** All SGO moneyline and spread markets now normalize and store correctly. Before this fix, ZERO game-line market data from SGO was being stored.  
**Shipped:** PR commit `1add1bd` — `inferSide()`, `stripSideSuffix()`, `inferParticipantId()` updated in both `sgo-fetcher.ts` and `sgo-normalizer.ts`.

---

### 2026-04-04: Odds API historical credit cost correction

**Source:** Odds API docs review  
**What it changed:** Old assumption was "1 credit per fetch." Correct: `10 × markets × regions`. Standard 3-market fetch = 30 credits/call. 100k credits is still sufficient for 90-day backfill (43,200 credits for 4 sports at 6h intervals).  
**Updated in:** `PROVIDER_DATA_DECISION_RECORD.md` Amendment A.

---

### 2026-04-04: SGO Rookie has no Pinnacle

**Source:** SGO pricing page + plan research  
**What it changes:** SGO Rookie ($99/mo, 100k objects) excludes Pinnacle. Without Pinnacle: no real edge, CLV degrades. Rookie permanently ruled out. Dev strategy: Odds API paid (Pinnacle included). Production: SGO Pro.  
**Documented in:** `PROVIDER_DATA_DECISION_RECORD.md` Amendment A.

---

### 2026-04-05: SGO MCP server available (`sports-odds-api-mcp`)

**Source:** SGO AI/vibe-coding docs at `sportsgameodds.com/docs/info/ai-vibe-coding`  
**What it unlocks:** In-session live API access via MCP tools — no script required. Eliminates the "write script → run → iterate" cycle for market key discovery, entity validation, usage checks, and grading debugging. All SGO REST capabilities accessible as MCP calls from Claude Code.  
**Key insight:** oddID format confirmed live during UTV2-388 (e.g. `passing_yards-JALEN_GREEN_1_NFL-game-ou-over`). NHL/NFL aliases written correctly in one pass — zero iteration cycles.  
**Setup:** `.mcp.json` at repo root with `sports-game-odds` server config (gitignored). See §1.13.  
**Action:** Use `get_stats` + `get_events` before writing any new normalizer mappings or provider_market_aliases. Use `get_usage_account` for in-session consumption checks.

---

### 2026-04-21: NRFI/YRFI — SGO gap documented (UTV2-706)

**Source:** `provider_offers` audit across all MLB `provider_market_key` values (2026-04-21).
**Finding:** SGO does not provide a dedicated NRFI (No Run First Inning) / YRFI boolean market key. No `*nrfi*`, `*yrfi*`, `*-yn*`, or first-inning yes/no variants exist in the MLB offer set.
**Closest proxy:** `points-all-1i-ou` (1st inning total O/U, covered by `1i_total_ou` in UTV2-704). An NRFI bet is equivalent to taking the Under at line 0.5 — but SGO serves this as a continuous O/U line, not a yes/no boolean.
**Action required:** Either (a) request a dedicated NRFI key from SGO support, or (b) derive NRFI from `points-all-1i-ou` with line constraint `≤ 0.5` in the smart-form / catalog layer. No implementation until SGO confirms availability or derivation approach is ratified.
**Affected issues:** UTV2-706 (closed as gap-documented).

---

### Future unlocks to investigate

| Item | Where to look | Why it matters |
|---|---|---|
| `odds.<oddID>.score` shape for ML/spread | SGO data explorer + live test | Confirm what score = 1 means for a moneyline win |
| `byBookmaker` structure under SGO Pro | Live trial data | Confirm `pinnacle` key exists and what fields it has |
| SGO results `expandResults=true` shape | SGO docs explorer | Understand full raw results for display use (box scores) |
| SGO historical `finalized` event access | Live trial test | Confirm we can fetch past finalized events for backfill grading |
| Odds API player prop structure | Docs | Understand description matching for prop canonicalization |
| SGO NRFI dedicated key | SGO support / changelog | Unlock boolean 1st-inning market without line constraint workaround |

---

## Update Rule

Add an entry to §4 (Discovered Unlocks Log) whenever:
- A new API capability is confirmed via docs or support
- A parameter, field, or pattern is discovered that changes what we can build
- A constraint or limitation is confirmed (prevents future wasted effort)
- A bug or misuse is identified and corrected

Each entry must include: source, what it unlocks, action required, affected files.
