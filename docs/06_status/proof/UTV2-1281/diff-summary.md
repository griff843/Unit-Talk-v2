# UTV2-1281 — Diff Summary

Event-scope the SGO player-prop fetch so a full-slate league (MLB) can no longer
exhaust the per-league wall-clock bound.

## Problem (live evidence, prod @ 61348ae3, 2026-06-17)

`system_runs` (`run_type=ingestor.cycle`), last 30 min:

| league | runs | status | avg duration |
|--------|------|--------|--------------|
| MLB    | 17   | **all `running`** | **217.7s** (pinned at the 240s `leagueTimeoutMs`) |
| NBA    | 17   | succeeded | 5.0s |
| NFL    | 17   | succeeded | 2.5s |

The dedicated player-prop fetch (UTV2-1275 Wave 1) was issued **league-wide**
(`leagueID=MLB` + 8 `PLAYER_ID`-wildcard `oddID` patterns + `includeOpenCloseOdds`
+ `includeOpposingOdds`). On a full June MLB slate that expands to every player on
every game and returns a payload large enough to burn the entire 240s budget across
pagination, so the MLB cycle never completes and MLB never produces offers. NBA/NFL
(offseason, tiny slates) run the identical fetch in seconds — the failure is
MLB-volume-specific, not the prop logic. (The 36h window bound from PR #1024 reduced
but did not eliminate it.)

## Fix (Option A — event-scope)

Instead of one league-wide prop request, scope the prop fetch to the specific event
IDs of the imminent slate (already enumerated by the game-line fetch), in small
batches, via the existing `eventID=` request param — the shape that already completes
in seconds for NBA/NFL.

## Files

### `apps/ingestor/src/sgo-player-prop-scope.ts` (new)
Pure helpers:
- `selectPlayerPropEventIds(events, snapshotAt, opts?)` — selects provider event IDs
  whose `startsAt` falls in the imminent window `[snapshot - 12h, snapshot + 36h]`
  (mirrors the prior league-wide prop window). Excludes events with missing/unparseable
  `startsAt`, de-duplicates, preserves order.
- `chunkEventIds(ids, size = 5)` — batches IDs into small scoped requests.

### `apps/ingestor/src/ingest-league.ts`
The player-prop branch now derives `scopedEventIds` (caller-supplied
`providerEventIds` if present, else `selectPlayerPropEventIds(gameLineResult.events,
snapshotAt)`), then issues one event-scoped `fetchAndPairSGOProps` per batch (with the
per-league abort-signal checkpoint between batches) and merges the batch results.
When the slate has no imminent events, **no** prop request is issued (cannot hang).

### `apps/ingestor/src/sgo-player-prop-scope.test.ts` (new)
8 unit tests: window selection (in/out of window, missing/bad `startsAt`, dedupe,
custom window) and batching (default size, explicit size, invalid-size coercion).

### `apps/ingestor/src/player-prop-ingest.test.ts`
Updated the split/freshness test to assert the prop request is **event-scoped**
(`eventID` = the slate event) and not Pinnacle-only; added a test that an empty slate
issues **no** league-wide prop request.

### `apps/ingestor/src/ingestor.test.ts`
Rate-limit telemetry test: its game-line fixture now starts within the imminent prop
window so the event-scoped prop fetch fires and the quota request count is unchanged.

## Out of scope

Game-line and results fetch behavior unchanged. No schema/migration. No production
writes from this lane. The orphaned-`running`/cycle-status observability gap on the
timeout path is noted but deferred (it disappears once MLB stops timing out).
