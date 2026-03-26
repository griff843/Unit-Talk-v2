# SGO Results API — Research Note

> Purpose: bounded research for the T1 Automated Grading contract (migration 012 / grading-service)
> Produced: 2026-03-26
> Updated: 2026-03-26 — **LIVE API PROOF ADDED** (§8). Live MLB call against completed events confirms full structure. All blockers RESOLVED.
> Status: COMPLETE — findings incorporated into T2_SGO_RESULTS_INGEST_CONTRACT.md
> Authority: `docs/06_status/PROGRAM_STATUS.md` wins on conflict

---

## 1. Summary Finding

SGO v2 **does** include final scores, team stats, and player stats in the same `/v2/events` endpoint used for odds ingestion. Results are embedded in the event object under a `results` key once a game is complete. There is **no separate results endpoint** — callers query `/v2/events` with the event's `eventID` or `leagueID` after game completion.

Sources: SGO product page ("All our API solutions include scores and results"), Reddit thread r/algobetting Jan 2025 (SGO staff confirmed "we also provide scores/stats data in the results object of each event"), Reddit thread r/algobetting Sep 2025 (SGO staff: "The results object holds the 'raw' score data… you can start scoring things as soon as the event is ended (status)").

---

## 2. Endpoint

```
GET https://api.sportsgameodds.com/v2/events
```

Auth: `apiKey=<SGO_API_KEY>` query param (same key already in `SGO_API_KEY` env var).

---

## 3. Query Patterns

### By leagueID (batch)

```
/v2/events?apiKey=KEY&leagueID=NBA&startsAfter=2026-03-25T00:00:00Z&startsBefore=2026-03-26T00:00:00Z
```

Returns all NBA events in the 24-hour window. Omit `oddsAvailable=true` so completed events
(with no live odds) are included.

### By eventID (single event)

```
/v2/events?apiKey=KEY&eventID=<providerEventId>
```

`providerEventId` matches `events.external_id` in V2 DB (populated by entity resolver).
Returns the single event object including its `results` block if the game is complete.

### By date range + leagueID (standard grading batch)

```
/v2/events?apiKey=KEY&leagueID=NBA&startsAfter=2026-03-25T00:00:00Z&startsBefore=2026-03-26T00:00:00Z
```

Filter server-side to events where `status.state` (or equivalent) = `'completed'`.

---

## 4. Results Object — Available Fields

Fields confirmed available in the `results` object (per SGO docs and community confirmation):

| Field | Description | Grading use |
|---|---|---|
| Scores by period | Point totals per quarter/period per team | Game-total and team-spread grading |
| Final score (home / away) | Total points at final | Team O/U grading |
| Player stat values | Per-player stat totals (points, assists, rebounds, etc.) | Player prop grading |
| Team stat values | Team-level aggregated stats | Team prop grading |

The stat keys in `results` use the same stat namespace as the `oddID` format:
`{statID}-{entityID}-{periodID}-{betTypeID}`. Example: `assists-PLAYER_ID-game-ou`.
This means the `market_key` used in `game_results` can be derived directly from the
`results` object key with no translation layer.

---

## 5. Status Gate for Grading Eligibility

The SGO event object includes a `status` block. The relevant field is the event completion state.
Based on SGO community docs, grading should be triggered when:

- `status` or `status.state` = `'completed'` (or similar terminal value)
- This matches `events.status = 'completed'` in V2 DB, which the ingestor already manages

Do **not** attempt grading on `'in_progress'` or `'scheduled'` events.

---

## 6. Implications for grading-service (T1 Automated Grading)

| Question | Answer |
|---|---|
| Does SGO have final stat values? | Yes — embedded in `results` object of completed events |
| Separate results endpoint? | No — same `/v2/events` endpoint |
| Query pattern | `?leagueID=X&startsAfter=Y&startsBefore=Z` or `?eventID=X` |
| Field mapping to market_key | Direct — stat namespace matches `oddID` format |
| When to query | After `events.status` transitions to `completed` |
| source value in game_results | `'sgo'` for SGO-sourced rows; `'manual'` for seed script rows |

---

## 7. Open Questions — RESOLVED by Live Proof (§8)

All three open questions from the initial research have been answered by the live API call on
2026-03-26 against completed MLB events.

- ✅ Exact JSON field names confirmed — see §8
- ✅ Status detection confirmed — `status.completed` boolean (not a string statusId)
- ✅ Results present without `oddsAvailable=true` — confirmed; `oddsAvailable: false` on completed events

---

## 8. Live API Proof — 2026-03-26

**Call made:** `GET /v2/events?apiKey=...&leagueID=MLB&startsBefore=2026-03-26T23:59:59Z&startsAfter=2026-03-24T00:00:00Z`

**Events returned:** Multiple completed MLB games with `status.completed=true`, `status.finalized=true`.

### 8.1 Status Field — Actual Structure

```json
"status": {
  "started": true,
  "completed": true,
  "cancelled": false,
  "ended": true,
  "live": false,
  "delayed": false,
  "finalized": true,
  "oddsAvailable": false,
  "displayShort": "F",
  "displayLong": "Final"
}
```

**Correction from prior research:** There is NO `statusId` string field. Completion is detected
via boolean flags: `status.completed === true` AND `status.finalized === true`.

The entity resolver's `mapSGOStatus()` function must check booleans, not strings:
```typescript
if (event.status?.completed && event.status?.finalized) return 'completed';
if (event.status?.live) return 'in_progress';
return 'scheduled';
```

### 8.2 Results Field — Actual Structure

The results object is a **nested object**, NOT flat `{statID}-{entityID}-{periodID}-{betTypeID}` keys.

```
results[periodID][entityId][statField] = number
```

Example from live data (Mets game):
```json
"results": {
  "game": {
    "BRANDON_NIMMO_1_MLB": {
      "batting_RBI": 2,
      "batting_atBats": 4,
      "batting_hits": 2,
      "batting_homeRuns": 1,
      "batting_strikeouts": 0,
      "points": 1
    },
    "MACKENZIE_GORE_1_MLB": {
      "pitching_inningsPitched": 4,
      "pitching_ERA": 0,
      "pitching_strikeouts": 3,
      "pitching_hits": 0,
      "pitching_runsAllowed": 0
    },
    "away": {
      "points": 2,
      "batting_hits": 6,
      "batting_RBI": 2,
      "pitching_strikeouts": 8
    },
    "home": {
      "points": 3,
      "batting_hits": 6,
      "batting_RBI": 3,
      "pitching_strikeouts": 8
    }
  },
  "1i": {"home": {"points": 0}, "away": {"points": 0}},
  "3i": {"home": {"points": 2}, "away": {"points": 0}}
}
```

### 8.3 Participant ID Format

Player entity IDs in the results object match the format `{NAME_PART_1_MLB}`:
- `BRANDON_NIMMO_1_MLB`
- `MACKENZIE_GORE_1_MLB`

These must match `participants.external_id` as stored by the entity resolver.
**Verify**: check that `apps/ingestor/src/entity-resolver.ts` stores participant `external_id`
in this exact format when ingesting from `players` field of SGO event response.

### 8.4 Stat Field Names (Confirmed)

**Baseball batting:** `batting_hits`, `batting_homeRuns`, `batting_RBI`, `batting_atBats`,
`batting_strikeouts`, `batting_doubles`, `batting_battingAvg`

**Baseball pitching:** `pitching_inningsPitched`, `pitching_ERA`, `pitching_strikeouts`,
`pitching_hits`, `pitching_runsAllowed`, `pitching_basesOnBalls`

**Universal:** `points` (fantasy points — not game score for player rows; for team rows it IS the score)

**Basketball (NBA — to be confirmed by NBA live call but expected):** `points`, `assists`,
`rebounds`, `steals`, `blocks`, `turnovers`

### 8.5 Design Correction

The prior Augment research note incorrectly described results keys as flat
`{statID}-{entityID}-{periodID}-{betTypeID}` strings. The `parseSGOResultKey()` function
designed in §4.3 of the T2 contract was WRONG and has been replaced with a stat-field
lookup approach. See T2_SGO_RESULTS_INGEST_CONTRACT.md §4.3 (corrected).

### 8.6 Boundary

All three original blockers on the T2 contract are now resolved by this live proof.
`T2_SGO_RESULTS_INGEST_CONTRACT.md` is updated to RATIFIED status.

The following still require the T2 implementation lane (not authorized by this research):
- Adding an SGO results fetch to `apps/ingestor`
- Writing `source: 'sgo'` rows to `game_results`
- Activating the grading service against SGO data

