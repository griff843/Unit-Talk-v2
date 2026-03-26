# T2 Contract: SGO Results Ingest — Populate game_results from Feed

> Tier: T2 (additive ingestor extension; no new migration; no settlement path change)
> Contract status: **RATIFIED** — all blockers resolved by live MLB API proof 2026-03-26
> Produced: 2026-03-26
> Ratified: 2026-03-26 — live SGO call confirmed results structure, status flags, participant ID format, and stat field names. See `sgo_results_api_research.md` §8.
> Depends on: T1 Automated Grading — must be CLOSED (game_results table must exist)
> Authority: `docs/06_status/PROGRAM_STATUS.md` wins on conflict

---

## 1. Objective

Automatically populate `game_results` with final stat values from the SGO feed (or an alternative
source confirmed by Augment research) so that the grading service can run without manual seeding.

**The specific gap being closed:**

T1 Automated Grading builds the `grading-service.ts` and `game_results` table, but its proof
requires manually seeded result rows. Once grading closes, every new completed game still requires
a human to insert results. This lane wires the feed so `game_results` populates automatically
after each game, enabling fully automatic grading without operator input.

**After this lane:** When the ingestor runs a cycle and detects that an event's status has moved to
`completed`, it fetches the final box score stats from SGO, maps them to `actual_value` per
market key, and inserts rows into `game_results`. The next grading pass picks them up
automatically.

---

## 2. Audit Summary

### What exists

| Item | State |
|------|-------|
| `game_results` table | Built by T1 Automated Grading (migration 012). Columns: `event_id`, `participant_id`, `market_key`, `actual_value`, `source`, `sourced_at`. UNIQUE on `(event_id, participant_id, market_key, source)`. |
| `GradeResultRepository.insert()` | Built by T1 Automated Grading. Available in `RepositoryBundle.gradeResults`. |
| `apps/ingestor/src/entity-resolver.ts` | Sets `events.status = 'scheduled'` on all upserted events. No completion detection. |
| `apps/ingestor/src/sgo-fetcher.ts` | Calls `v2/events` with `oddsAvailable=true` and `startsAfter=now`. Fetches upcoming events only. |
| `domain/src/outcomes/stat-resolver.ts` | `resolveActualValue(marketKey, stats)` — maps domain market keys (`player_assists_ou`) to actual values from a box score stats object. Uses underscore format, not SGO hyphen format. |
| `provider_offers.provider_market_key` | SGO hyphen format: `assists-all-game-ou`, `points-all-game-ou`. This IS the canonical market key namespace for V2. |
| `picks.market` | Currently set at submission time. Smart Form picks: free-form capper input. Discord bot picks: `'NBA - Player Prop'` format. **Neither matches SGO market key format.** |

### Market Key Alignment — The Core Problem

Two incompatible namespaces exist:

| Source | Example | Format |
|--------|---------|--------|
| SGO `provider_offers.provider_market_key` | `assists-all-game-ou` | SGO hyphen |
| Domain `stat-resolver.ts` keys | `player_assists_ou` | Legacy underscore |
| `picks.market` (Discord bot) | `NBA - Player Prop` | Human-readable composite |
| `picks.market` (Smart Form) | Capper-entered text | Free-form |

**Design decision for this lane:**

`game_results.market_key` uses **SGO hyphen format** — matching `provider_offers.provider_market_key`.
This is the canonical V2 market key namespace.

The results ingest service maps SGO box score stat fields → `game_results.actual_value` using a
**new SGO-specific stat translation table** (`SGO_STAT_TO_MARKET_KEY`) defined in the ingestor.
This is separate from `domain/stat-resolver.ts` (which maps legacy underscore keys).

The grading service matches `pick.market` against `game_results.market_key`. When `pick.market`
doesn't match (`'NBA - Player Prop'` ≠ `'assists-all-game-ou'`), grading gracefully skips.
Market key normalization (mapping `pick.market` → SGO format) is a **separate future lane** —
not in scope here.

### What Is Missing

| Gap | Closed by this lane |
|-----|---------------------|
| No SGO results fetch path | New `fetchSGOResults()` in `apps/ingestor/src/results-fetcher.ts` |
| No event completion detection | Entity resolver update: mark events `completed` when SGO `status.statusId` indicates game over |
| No stat → `actual_value` translation (SGO format) | New `SGO_STAT_TO_MARKET_KEY` mapping in ingestor |
| No results write to `game_results` | New `resolveAndInsertResults()` in `apps/ingestor/src/results-resolver.ts` |
| No results phase in ingest cycle | `apps/ingestor/src/index.ts` extended with results phase after entity resolution |

---

## 3. Tier Decision

**T2** — three reasons:

1. **No new migration** — `game_results` table and index are built by T1 Automated Grading (migration 012). This lane writes into an existing table.
2. **No settlement path changes** — grading writes settlements; this lane only writes `game_results`. No `settlement_records` touch.
3. **Additive ingestor extension only** — new files in `apps/ingestor/src/`. No package-level changes. No `@unit-talk/db` repository interface changes beyond what T1 Grading already adds.

Would escalate to T1 if: a new index is needed on `game_results` beyond what migration 012 provides, or a new table is required for intermediate stat storage. Neither is expected.

---

## 4. Scope

### 4.1 Event Completion Detection

Extend `apps/ingestor/src/entity-resolver.ts` to map SGO event status to canonical `events.status`:

```typescript
// Confirmed by live SGO API call 2026-03-26 — status uses boolean flags, not a statusId string
function mapSGOStatus(status: SGOEventStatus | null | undefined): EventStatus {
  if (!status) return 'scheduled';
  if (status.completed && status.finalized) return 'completed';
  if (status.live) return 'in_progress';
  return 'scheduled';
}

interface SGOEventStatus {
  started: boolean;
  completed: boolean;
  cancelled: boolean;
  ended: boolean;
  live: boolean;
  delayed: boolean;
  finalized: boolean;
  oddsAvailable: boolean;
}
```

**Confirmed by live proof:** No `statusId` string field exists. Completion is detected via
`status.completed === true && status.finalized === true`. Live events use `status.live === true`.
Source: `docs/05_operations/sgo_results_api_research.md` §8.1.

### 4.2 SGO Results Fetch

New file: `apps/ingestor/src/results-fetcher.ts`

The current `v2/events` endpoint with `oddsAvailable=true` only returns future events with
available odds. To get results for completed events, the options are (in priority order):

**Confirmed (Augment research 2026-03-26):** Same endpoint, drop `oddsAvailable` filter, query past date range.
No separate results endpoint exists. Results are embedded in the event object once complete.

```
GET /v2/events?apiKey=...&leagueID=NBA&startsBefore=<now>&startsAfter=<48h ago>
```

Returns recently-completed events. Filter to events where status indicates completion.
The results block is embedded in the event object — no second request needed per event.

Source: `docs/05_operations/sgo_results_api_research.md` §2–3.

```typescript
export interface SGOResultsFetchOptions {
  apiKey: string;
  league: string;
  snapshotAt: string;
  lookbackHours?: number;   // default: 48 — how far back to check for completed events
  fetchImpl?: typeof fetch;
}

export interface SGOEventResult {
  providerEventId: string;
  statusId: string | null;
  playerStats: SGOPlayerStatRow[];
}

export interface SGOPlayerStatRow {
  providerParticipantId: string;
  stats: Record<string, number>;  // e.g. { assists: 7, points: 22, rebounds: 4 }
}

export async function fetchSGOResults(
  options: SGOResultsFetchOptions,
): Promise<SGOEventResult[]>
```

### 4.3 SGO Results Structure → actual_value Extraction

**Corrected 2026-03-26 by live API proof.** Prior design (flat key parsing) was wrong.

The SGO `results` object is a **nested structure**, not flat keys:

```
results[periodID][entityId][statField] = number
```

- `periodID`: `'game'` for game-total (what we use), `'1i'`/`'2i'` etc. for period splits
- `entityId`: player external ID (e.g. `'BRANDON_NIMMO_1_MLB'`) or `'home'`/`'away'` for teams
- `statField`: stat name (e.g. `'batting_hits'`, `'points'`, `'assists'`)

**To get actual_value for a pick:**
1. Find the participant's `external_id` (e.g. `'BRANDON_NIMMO_1_MLB'`)
2. Navigate `event.results?.game?.[participantExternalId]`
3. Look up the stat field for the market key using the mapping table below
4. That numeric value IS the `actual_value`

**Market key → stat field mapping** (required; confirmed from live data):

```typescript
// Maps provider_market_key → SGO stat field name(s) in results.game[entityId]
// For combo markets, sum all listed fields.
// Confirmed stat fields from live MLB data; NBA fields are the equivalent without prefix.
const MARKET_KEY_TO_STAT_FIELD: Record<string, string[]> = {
  // Baseball batting
  'batting-hits-all-game-ou':         ['batting_hits'],
  'batting-home-runs-all-game-ou':    ['batting_homeRuns'],
  'batting-rbi-all-game-ou':          ['batting_RBI'],
  'batting-strikeouts-all-game-ou':   ['batting_strikeouts'],
  'batting-total-bases-all-game-ou':  ['batting_totalBases'],   // confirm field name in NBA call

  // Baseball pitching
  'pitching-strikeouts-all-game-ou':      ['pitching_strikeouts'],
  'pitching-innings-pitched-all-game-ou': ['pitching_inningsPitched'],

  // Basketball (NBA — stat field names to be verified in first NBA live call)
  'points-all-game-ou':        ['points'],
  'assists-all-game-ou':       ['assists'],
  'rebounds-all-game-ou':      ['rebounds'],
  'steals-all-game-ou':        ['steals'],
  'blocks-all-game-ou':        ['blocks'],
  'turnovers-all-game-ou':     ['turnovers'],
  'pra-all-game-ou':           ['points', 'rebounds', 'assists'],   // sum
  'pts-rebs-all-game-ou':      ['points', 'rebounds'],
  'pts-asts-all-game-ou':      ['points', 'assists'],
  'rebs-asts-all-game-ou':     ['rebounds', 'assists'],
  'blocks-steals-all-game-ou': ['blocks', 'steals'],
};
```

**`actual_value` computation:**
```typescript
function resolveActualValue(
  marketKey: string,
  playerStats: Record<string, number>,
): number | null {
  const fields = MARKET_KEY_TO_STAT_FIELD[marketKey];
  if (!fields) return null;
  const values = fields.map(f => playerStats[f]).filter(v => typeof v === 'number');
  if (values.length !== fields.length) return null;  // missing field → skip
  return values.reduce((a, b) => a + b, 0);
}
```

**Participant ID format confirmed:** `BRENDAN_NIMMO_1_MLB` — uppercase with underscores and
league suffix. Entity resolver must store `participants.external_id` in this exact format.
Verify during implementation before inserting `game_results` rows.

Source: `docs/05_operations/sgo_results_api_research.md` §8.2–8.4.

### 4.4 Results Resolver

New file: `apps/ingestor/src/results-resolver.ts`

```typescript
export interface ResultsResolutionSummary {
  processedEvents: number;
  completedEvents: number;
  insertedResults: number;
  skippedResults: number;   // no stat mapping or missing fields
  errors: number;
}

export async function resolveAndInsertResults(
  eventResults: SGOEventResult[],
  repositories: Pick<IngestorRepositoryBundle, 'events' | 'participants' | 'gradeResults'>,
  logger?: Pick<Console, 'warn' | 'info'>,
): Promise<ResultsResolutionSummary>
```

**Algorithm:**
1. For each `SGOEventResult`:
   - Look up `events.id` by `external_id = providerEventId`
   - Skip if event not found or `events.status !== 'completed'`
   - For each `SGOPlayerStatRow`:
     - Look up `participants.id` by `external_id = providerParticipantId`
     - Skip if participant not found
     - For each market key in `SGO_MARKET_KEY_TO_STAT_FIELDS`:
       - Compute `actual_value` by summing mapped stat fields
       - Skip if any required field missing
       - Call `gradeResults.insert({ eventId, participantId, marketKey, actualValue, source: 'sgo', sourcedAt: now })`
       - UNIQUE constraint handles idempotency — duplicate insert is silently ignored

### 4.5 Ingest Cycle Extension

Extend `apps/ingestor/src/index.ts` to add a results phase after entity resolution:

```
Phase 1 (existing): fetchAndPairSGOProps → upsertBatch (provider_offers)
Phase 2 (existing): resolveSgoEntities → upsert events, participants, event_participants
Phase 3 (NEW):      fetchSGOResults → resolveAndInsertResults → insert game_results
```

Phase 3 only runs when the cycle includes recently-completed events. It should be
independently skippable (feature flag `UNIT_TALK_INGESTOR_SKIP_RESULTS=true`) without
breaking phases 1 and 2.

---

## 5. Non-Goals

- **No market key normalization** — `picks.market` → SGO market key mapping is a separate future lane. Discord bot picks will still have `null` CLV and skip grading until that lane closes.
- **No `stat-resolver.ts` changes** — that domain layer uses the legacy underscore format. The ingestor uses a separate SGO-format mapping. Do not merge or modify the domain layer.
- **No settlement writes** — this lane only writes `game_results`. Grading service writes settlements.
- **No new Discord output** — no bot notifications from results ingest.
- **No operator web changes** — the operator dashboard shows grading results via existing settlement surfaces. No new HTML sections required.
- **No historical backfill** — only events from the current and recent ingest window are processed. Historical backfill is a separate maintenance script.
- **No multi-provider consensus** — SGO only. Second provider results is a separate T2 lane.
- **No game totals / team results in V1** — player props only. Team/game-level results (spread, moneyline, game total) require a separate stat field mapping and are explicitly deferred.

---

## 6. Implementation Surface

| File | Change |
|------|--------|
| `apps/ingestor/src/results-fetcher.ts` | NEW — `fetchSGOResults()`, `SGOEventResult`, `SGOPlayerStatRow` |
| `apps/ingestor/src/results-resolver.ts` | NEW — `resolveAndInsertResults()`, `SGO_MARKET_KEY_TO_STAT_FIELDS`, `ResultsResolutionSummary` |
| `apps/ingestor/src/entity-resolver.ts` | Extend `mapSGOStatus()` to set `events.status = 'completed'` for terminal SGO states |
| `apps/ingestor/src/index.ts` | Add Phase 3 (results fetch + resolve) after entity resolution |
| `packages/db/src/repositories.ts` | Add `gradeResults` slot to `IngestorRepositoryBundle` (currently only in `RepositoryBundle`) |
| `apps/ingestor/src/ingestor-test.ts` (or equivalent) | Tests for completion detection, stat mapping, idempotency |

**Do not touch:**
- `packages/domain/src/outcomes/stat-resolver.ts` — do not modify domain layer
- `apps/api/src/grading-service.ts` — grading is a separate lane
- `apps/api/src/settlement-service.ts` — no settlement changes
- `packages/db/src/database.types.ts` — no migration needed; run `pnpm supabase:types` if schema changes occur upstream

---

## 7. Acceptance Criteria

| # | Criterion | Testable? |
|---|-----------|-----------|
| AC-1 | `mapSGOStatus()` correctly marks events `completed` for all known SGO terminal statusId strings | ✅ Unit test |
| AC-2 | `fetchSGOResults()` returns player stat rows for recently-completed events | ✅ Integration test with mock fetch |
| AC-3 | `resolveAndInsertResults()` inserts correct `actual_value` for a player with known stats | ✅ Unit test |
| AC-4 | Combo market keys (`pra-all-game-ou`) produce the correct summed `actual_value` | ✅ Unit test |
| AC-5 | `resolveAndInsertResults()` skips players with no matching participant in DB — no error | ✅ Unit test |
| AC-6 | `resolveAndInsertResults()` skips market keys with missing stat fields — no error | ✅ Unit test |
| AC-7 | Running ingest twice for the same completed event does not create duplicate `game_results` rows (UNIQUE constraint idempotency) | ✅ Unit test |
| AC-8 | Live proof: run bounded NBA ingest cycle, confirm `game_results` rows inserted for a completed game with correct `market_key` and `actual_value` | ✅ Live DB query |
| AC-9 | Live proof: grading service can pick up inserted `game_results` rows and settle a posted pick automatically (end-to-end: ingest → grade → settle) | ✅ Live proof |
| AC-10 | `UNIT_TALK_INGESTOR_SKIP_RESULTS=true` disables Phase 3 without breaking Phase 1/2 | ✅ Unit test |
| AC-11 | `pnpm verify` exits 0; root test count ≥ (post-grading count) + ≥8 net-new tests | ✅ CI |

---

## 8. Ratification Status — ALL BLOCKERS RESOLVED

**Contract is RATIFIED.** Live MLB API call on 2026-03-26 resolved all three blockers.

**Blocker 1 — SGO results source confirmed:** ✅ RESOLVED
- `v2/events` without `oddsAvailable=true` returns completed events with full results embedded
- Source: `docs/05_operations/sgo_results_api_research.md` §8

**Blocker 2 — SGO completion detection confirmed:** ✅ RESOLVED
- Detection uses boolean flags: `status.completed === true && status.finalized === true`
- NOT a statusId string — prior design was wrong; §4.1 corrected
- Source: `sgo_results_api_research.md` §8.1

**Blocker 3 — SGO results JSON shape confirmed:** ✅ RESOLVED
- Results structure: `results[periodID][entityId][statField]` — nested object
- Participant IDs are `PLAYER_NAME_N_LEAGUE` format (e.g. `BRANDON_NIMMO_1_MLB`)
- Stat fields confirmed for baseball; NBA fields expected to follow same pattern
- Mapping table in §4.3 replaces the now-invalidated `parseSGOResultKey()` flat-key approach
- Source: `sgo_results_api_research.md` §8.2–8.5

**NBA stat field names:** First live NBA ingest run should log all stat field names from
`results.game[participantId]` for at least one player — this confirms the NBA column in the
mapping table and allows expanding it. This is a normal implementation verification step,
not a new blocker.

---

## 9. Proof Requirements (T2)

Before Claude marks this sprint CLOSED:

1. **`pnpm verify` exits 0** with ≥8 net-new tests
2. **Live ingest proof:** Run bounded NBA ingest with results phase enabled. Show:
   - `SystemRun` with `status: succeeded` including results phase metrics
   - At least one `game_results` row in live DB with `source: 'sgo'`, correct `market_key`, plausible `actual_value`
3. **End-to-end proof:** A posted pick that was previously ungraded is automatically settled after the results ingest runs. Show: `settlement_records` row with `source: 'grading'`, `result: 'win' | 'loss' | 'push'`.
4. **Idempotency proof:** Run ingest twice for the same completed event. Confirm `game_results` row count does not increase.

---

## 10. Rollback Plan

All changes are in `apps/ingestor/src/` only.

```bash
# Revert ingestor files — no DB migration to undo
git revert <commit>
pnpm verify
```

`game_results` rows with `source: 'sgo'` already inserted are harmless — existing graded
settlements remain valid. The grading service reads from `game_results` but is not broken
by extra rows.

The `events.status = 'completed'` updates are idempotent. Reverting entity-resolver does not
revert existing status values in the DB, but the grading service handles any `events.status`
state gracefully.

---

## 11. Deferred Items

| Item | When |
|------|------|
| Game totals / team-level results ingest | Follow-on T3 — team box scores have different structure |
| Second provider results (OddsAPI or equivalent) | After second odds provider integration |
| Historical results backfill script | Maintenance lane — does not block current grading |
| Market key normalization (`pick.market` → SGO key) | Critical for Discord-submitted picks to get CLV + grading; separate T2 lane |
| Results ingest scheduling (cron) | T3 — automate the ingest cycle trigger |
