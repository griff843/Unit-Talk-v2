# Provider Knowledge Base

**Status:** Living document — update whenever new API capabilities, limits, or patterns are discovered.  
**Authority:** T1 operational reference. Owned by PM (A Griffin).  
**Purpose:** Prevent rediscovery. Every unlock, constraint, and integration pattern goes here so future sessions start from knowledge, not from scratch.

---

## Table of Contents

1. [SGO (Sports Game Odds)](#1-sgo-sports-game-odds)
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

### Future unlocks to investigate

| Item | Where to look | Why it matters |
|---|---|---|
| `odds.<oddID>.score` shape for ML/spread | SGO data explorer + live test | Confirm what score = 1 means for a moneyline win |
| `byBookmaker` structure under SGO Pro | Live trial data | Confirm `pinnacle` key exists and what fields it has |
| SGO results `expandResults=true` shape | SGO docs explorer | Understand full raw results for display use (box scores) |
| SGO historical `finalized` event access | Live trial test | Confirm we can fetch past finalized events for backfill grading |
| Odds API player prop structure | Docs | Understand description matching for prop canonicalization |

---

## Update Rule

Add an entry to §4 (Discovered Unlocks Log) whenever:
- A new API capability is confirmed via docs or support
- A parameter, field, or pattern is discovered that changes what we can build
- A constraint or limitation is confirmed (prevents future wasted effort)
- A bug or misuse is identified and corrected

Each entry must include: source, what it unlocks, action required, affected files.
