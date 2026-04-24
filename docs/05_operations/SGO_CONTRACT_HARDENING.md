# SGO Contract Hardening — Provider Contract Matrix & Change Log

**Status:** Living document. Update whenever a hardening fix lands or a new contract rule is ratified.
**Owner:** Claude lane (UTV2-741). Implementation changes stay with Codex; this doc owns the rules.
**Cross-reference:** `PROVIDER_KNOWLEDGE_BASE.md` (request semantics), `SPORTSGAMEODDS_API_REFERENCE.md` (endpoint reference)
**Last updated:** 2026-04-23 / main SHA `aefa48a`

---

## 1. Request Contract Matrix

Four distinct request modes. Each has a different required param set. They are not interchangeable.

### 1.1 Live Odds Ingest

| Parameter | Value | Required |
|---|---|---|
| `leagueID` | `NBA`, `MLB`, `NHL`, etc. | ✅ |
| `startsAfter` | 12h rolling window | ✅ |
| `oddsAvailable` | `true` | ✅ |
| `includeOpenCloseOdds` | omit | — |
| `finalized` | omit | — |

`isOpening` flag: set on first-seen combination per `findExistingCombinations()` check before insert. Not a provider field — computed locally.

### 1.2 Historical CLV Ingest

| Parameter | Value | Required |
|---|---|---|
| `leagueID` | target league | ✅ |
| `startsAfter` | bounded start | ✅ |
| `startsBefore` | bounded end | ✅ |
| `finalized` | `true` | ✅ |
| `includeOpenCloseOdds` | `true` | ✅ — required for per-bookmaker Pinnacle open/close |
| `includeAltLines` | `true` | recommended |

**Rule:** Historical mode without `includeOpenCloseOdds=true` will not capture `byBookmaker.pinnacle.openOdds` / `closeOdds`. Those are the only fields that constitute a Pinnacle-specific CLV line. `openFairOdds` on the top-level object is consensus, not Pinnacle, and is prohibited for CLV proof (see §4.2).

### 1.3 Finalized Results Fetch

| Parameter | Value | Required |
|---|---|---|
| `leagueID` | target league | ✅ |
| `startsAfter` | bounded start | ✅ |
| `startsBefore` | bounded end | ✅ |
| `finalized` | `true` | ✅ |
| `expandResults` | `true` | optional — for raw stat display only, not grading |

**Rule:** Use `status.finalized=true` as the completion gate. Never gate on `status.completed` — SGO does not set it consistently across all event types (playoff games, certain formats). See `PROVIDER_KNOWLEDGE_BASE.md §1.7` and `entity-resolver.ts:mapSGOStatus()`.

**Rule:** Cursor pagination required for any window spanning more than ~100 events. Use `nextCursor` from response. A 404 response = end of results (not an error). Do not change other params between cursor pages.

### 1.4 Targeted Repair / Bounded Backfill

| Parameter | Value | Required |
|---|---|---|
| `leagueID` | specific league | ✅ |
| `startsAfter` + `startsBefore` | narrow date bounds | ✅ — no unbounded pulls |
| `finalized` | `true` | ✅ |
| `providerEventIds` | specific event IDs | when targeting known events |

**Rule:** All backfill runs must be bounded. No unbounded historical pulls. Unbounded pulls time out and produce no auditable record of what was fetched.

### 1.5 Pagination Contract (all modes)

| Rule | Status |
|---|---|
| Use `nextCursor` from response | ✅ |
| 404 response = end of results, not an error | ✅ documented |
| Do not change other params between cursor requests | ✅ documented |
| SGO API default limit: 10 events. Set `limit` explicitly (max ~100 for odds queries) | ✅ |
| Supabase PostgREST default row cap: 1000 rows without `.range()` | ✅ fixed UTV2-738 |
| All DB queries against high-volume tables (`provider_offers`) must use `.range(from, from+PAGE-1)` | ✅ fixed UTV2-738 |

---

## 2. Market Identity Contract

### 2.1 `oddID` Format

```
{statID}-{statEntityID}-{periodID}-{betTypeID}-{sideID}
```

| Component | Player prop value | Game/team value |
|---|---|---|
| `statID` | `points`, `rebounds`, `assists`, `batting_hits`, etc. | `points`, `batting_hits`, etc. |
| `statEntityID` | `JALEN_BRUNSON_1_NBA` (player ID) | `home`, `away`, `all` |
| `periodID` | `game`, `1h`, `1q`, `2h` | `game`, `reg`, `1h`, etc. |
| `betTypeID` | `ou` | `ml`, `sp`, `ou` |
| `sideID` | `over`, `under` | `home`, `away`, `over`, `under` |

### 2.2 Participant-Required vs. Participant-Forbidden

**Participant-required markets (player props):**
- `statEntityID` is a player ID string
- `providerParticipantId` MUST be preserved in `provider_offers` — never collapsed to `all`
- `missing_participant_id` on a player prop is a fatal grading skip — not retriable until the alias is backfilled
- Canonical market key suffix: `player_*` family

**Participant-forbidden markets (game lines):**
- `statEntityID` is `home`, `away`, or `all`
- `participant_id` must be null in `game_results` and `picks`
- Canonical market key suffix: `game_*` family

**Rule:** The materializer must NOT collapse player `statEntityID` to `all`. Player prop oddIDs must route through the participant alias lookup before `canonical_market_key` is resolved. Enforcement pending: UTV2-732.

### 2.3 Market Key Normalization

Our normalized market key strips the `statEntityID` and `-sideID` suffix:

```
points-JALEN_BRUNSON_1_NBA-game-ou-over  →  points-all-game-ou
                                              + providerParticipantId: JALEN_BRUNSON_1_NBA
```

`results-resolver.ts` stores `game_results` with the canonical market key (from `SGO_MARKET_KEY_TO_CANONICAL_ID` map). The grading-service join must use the same canonical form — not the raw SGO key.

---

## 3. Grading / Settlement Admissibility Contract

| Rule | Enforced in | Status |
|---|---|---|
| Gate on `status.finalized=true` | `entity-resolver.ts:mapSGOStatus()` | ✅ fixed UTV2-734 |
| Never gate on `status.completed` alone | `sgo-fetcher.ts:extractEventResult()` | ✅ |
| Use `odds.<oddID>.score` as the grading value | `results-resolver.ts` | ✅ fixed UTV2-726 |
| Do NOT use `event.results.game` for grading | `results-resolver.ts` (comment at top) | ✅ documented |
| Check `scoringSupported=true` before trusting `score` | — | ⚠️ UTV2-742 |
| Local events table must show `status = 'completed'` before grading runs | `grading-service.ts:112` | ✅ (mapSGOStatus gates this) |
| Repoll for events finalized upstream but still `in_progress` locally | — | ⚠️ UTV2-745 |
| Production settlement: wait for `finalized` | grading cron | ✅ documented |
| Fast-settle mode: `ended=true` acceptable with correction risk | optional | ✅ documented |

**Timing note from SGO support:** SGO typically finalizes within 1 hour of `ended=true`. Stat corrections can arrive after `ended`. Waiting for `finalized` eliminates correction risk.

---

## 4. CLV Data Contract

### 4.1 What Each Field Represents

| SGO Field | What it is | Approved use |
|---|---|---|
| `fairOdds` | Current consensus vig-free | Edge calculation fallback (tier 3), operator display |
| `bookOdds` | Current consensus with vig | Reference display |
| `openFairOdds` | Consensus opening fair line | Opening line display ONLY — not CLV proof |
| `openBookOdds` | Consensus opening with vig | Opening line display ONLY — not CLV proof |
| `byBookmaker.pinnacle.closeOdds` | Pinnacle closing line (requires `includeOpenCloseOdds=true`) | CLV proof benchmark |
| `byBookmaker.pinnacle.openOdds` | Pinnacle opening line | CLV opening baseline |

### 4.2 CLV Prohibited Uses (Policy Lock — §3.7)

The following substitutions are explicitly prohibited:

1. `fairOdds` / `openFairOdds` as CLV closing-line proof — these are consensus, not Pinnacle
2. Live SGO fetch at settlement time as a substitute for the stored `provider_offers` row — not reproducible
3. Storing consensus fields in `settlement_records.payload.clv` as Pinnacle CLV
4. Any shortcut that bypasses the `findClosingLine()` DB query against stored `provider_offers` rows

### 4.3 Current CLV Implementation Path

```
pick submission
  → provider_offers row stored with is_opening=true (Pinnacle or SGO consensus)

pick settlement
  → clv-service.findClosingLine()
  → DB query: SELECT * FROM provider_offers WHERE ... AND snapshot_at <= starts_at AND is_closing=true
  → closing row found → CLVResult computed
  → stored in settlement_records.payload.clv
```

**providerKey in use:** `sgo` (consensus). Pinnacle-specific `sgo:pinnacle` key path not yet built.

### 4.4 CLV Coverage Status

As of 2026-04-23T13:52Z (post UTV2-738, main SHA `aefa48a`):

| Sport | Rows (72h window) | With closing_line | Coverage |
|---|---|---|---|
| MLB | 783 | 690 | 88.1% |
| NBA | 192 | 159 | 82.8% |
| NHL | 25 | 4 | 16.0% (low volume) |

NHL at 16.0% reflects thin posting volume during playoffs, not a methodology gap.

---

## 5. Hardening Change Log

Every accepted rule change with issue reference and effective rule. Ordered by merge date.

| Date | Issue | PR / SHA | Symptom | Rule Established |
|---|---|---|---|---|
| 2026-04 (pre-sprint) | UTV2-664 | PR #408 | SGO raw market key format mismatch in `game_results` lookup — grading always missed | Normalize provider market key to canonical form before `game_results` join |
| 2026-04 (pre-sprint) | UTV2-715 | PR #442 | Moneyline CLV never computed — wrong side inferred for ML markets | ML picks must use `home`/`away` participant role to infer `over`/`under` side for CLV |
| 2026-04 (pre-sprint) | UTV2-716 | — | Player prop CLV never computed — `participant_id` missing from canary submission | Player prop picks must carry `participant_id` through submission for CLV service to resolve |
| 2026-04-22 | UTV2-721 | `924c9f2` | Historical SGO ingest not requesting open/close odds — CLV fields absent from backfill rows | Historical mode must include `includeOpenCloseOdds=true` to capture `byBookmaker.pinnacle.openOdds/closeOdds` |
| 2026-04-22 | UTV2-726 | `c9a58a0` | SGO result joins using raw `results.game` stat accumulation — wrong for odds market grading | Result resolution must use `odds.<oddID>.score` directly, not stat accumulation from `results` object |
| 2026-04-23 | UTV2-734 | PR #448 | Finalized results backfill timed out; local events never promoted to `completed`; grading skipped on `event_not_completed` | `status.finalized=true` maps to `'completed'` in `events.status` via `mapSGOStatus()` in `entity-resolver.ts`. `status.completed` is not reliable and must not be used as a gate. |
| 2026-04-23 | UTV2-733 | PR #452 | Legacy game-total picks skipping grading — market key join broken for totals market family | `market-key.ts` and `pick-foreign-keys.ts` must handle legacy totals market family shapes; grading join uses canonical form, not raw market key |
| 2026-04-23 | UTV2-738 | PR #449 | `market_universe.closing_line = 0` for MLB — materializer DESC cap cut off pre-commence closing rows | `listClosingOffers()` must be fetched independently from `listRecentOffers()` and merged by `id` before grouping — closing rows have pre-commence `snapshot_at` values that fall outside a DESC-capped window |
| 2026-04-23 | UTV2-738 | PR #451 | `listClosingOffers()` returning only first 1000 rows — PostgREST implicit cap | Any DB query against tables with >1000 relevant rows must use explicit `.range(from, from+PAGE-1)` pagination. Supabase PostgREST silently truncates without an error when no range is specified. |

---

## 6. Needs Standard — Open Ambiguities

Not invented. These are documented edges where current implementation does not yet apply an explicit rule.

| Item | Gap | Assigned Issue |
|---|---|---|
| Participant-required vs. participant-forbidden rule table (exhaustive, per market family) | 40 `missing_participant_id` skips remain after UTV2-733 | UTV2-740 (Ready for Codex) |
| Participant-aware market aliasing in materializer — player `statEntityID` must not collapse to `all` | materializer `canonical_market_key` resolution can misroute player props to game-total type | UTV2-732 (Ready for Codex) |
| Centralized SGO request contract module — single source for param shapes | Live ingest, historical ingest, finalized results, and repair all construct params independently | UTV2-743 (Ready for Codex) |
| `scoringSupported=true` as a hard gate before using `score` | Documented but not enforced in code path | UTV2-742 (Ready for Codex) |
| `includeOpenCloseOdds=true` always present in historical ingest (currently conditional) | Per-bookmaker open/close may be absent from some historical rows | UTV2-744 (Ready for Codex) |
| Settlement admissibility policy — when to repoll, when to definitively skip | Events still showing `in_progress` after finalization window are not being repolled | UTV2-745 (Ready for Codex) |
| `event_id` FK resolution in `market_universe` (currently `null`) | Replay joins cannot use event FK | Deferred — Phase 3 materializer contract |
