# UTV2-1266 Verification

## Summary

SGO ingestor: disable `includeAltLines`, add Pro-plan REST polling optimizations.

Root cause fixed: `includeAltLines=true` in historical mode caused alt-line contamination
(bd9d71a6 Champagnie 3PM 2.5 vs main line 1.5 — ALT_LINE FAIL).

## Evidence

### Changes Applied

1. **`includeAltLines` removed** from `buildSgoOddsRequestUrl` historical path (`sgo-request-contract.ts`)
2. **`includeOpenCloseOdds=true` preserved** — required for CLV calculation
3. **`includeOpposingOdds=true` preserved** — required for paired prop markets
4. **`pinnacleOnly?: boolean`** added to request contract, SGOFetchOptions, IngestLeagueOptions, IngestorRunnerOptions
5. **`UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK`** added to SchedulerEnv; when enabled + in peak window, passes `bookmakerID=pinnacle`
6. **`.env.container.example`** updated with all 6 scheduling vars
7. **Hetzner `.env.production`** updated with scheduling vars (applied 2026-06-12)
8. **Test updated**: assert `includeAltLines=null` (previously expected `'true'`)
9. **PROVIDER_KNOWLEDGE_BASE.md** updated: includeAltLines disposition permanently disabled
10. **`playerPropOddIdPatterns?: string[]`** added to `SGOOddsRequestOptions` — enables PLAYER_ID wildcard filtering for player prop markets; mutually exclusive with `pinnacleOnly` (Pinnacle carries no player-prop data, verified live 2026-06-12)
11. **`SGO_PLAYER_PROP_ODD_ID_PATTERNS`** exported constant — confirmed patterns for MLB (batting_hits, batting_totalBases, batting_homeRuns, batting_RBI) and NBA (points, rebounds, assists, threePointersMade)
12. **5xx retry logic** added to `fetchSgoJson`: 500/503 → retry once with 3s backoff; 504 → log URL + page hint, retry once with 5s backoff. Per SGO docs: "retry once after delay"
13. **Non-JSON body handling** added to `fetchSgoJson`: `JSON.parse` wrapped in try/catch; non-JSON responses treated as transient and retried once, then fail closed with a descriptive error
14. **`sanitizeSGOUsageForLog`** exported function — strips keyID, email, customerID from raw usage response before logging; prevents credential exposure in log lines

### SGO API Live Test Results (2026-06-12)

#### Parameter Names
- `oddID` (singular) — correct; `oddIDs` plural not accepted
- `includeOpposingOdds` — correct per API behavior; guide shows `includeOpposingOddIDs` but code has the right name
- `includeOpenCloseOdds=true` — confirmed works in historical mode; returns `openOdds`/`closeOdds` fields

#### PLAYER_ID Wildcard
- `batting_hits-PLAYER_ID-game-ou-over` and `*-under` → returns multi-player data for MLB ✓
- `batting_totalBases-PLAYER_ID-game-ou-over/under` → returns multi-player data for MLB ✓
- `batting_homeRuns-PLAYER_ID-game-ou-over/under` → returns multi-player data for MLB ✓
- `batting_RBI-PLAYER_ID-game-ou-over/under` → returns multi-player data for MLB ✓
- `points-PLAYER_ID-game-ou-over/under` → returns multi-player data for NBA ✓
- `rebounds-PLAYER_ID-game-ou-over/under` → returns multi-player data for NBA ✓
- `assists-PLAYER_ID-game-ou-over/under` → returns multi-player data for NBA ✓
- `threePointersMade-PLAYER_ID-game-ou-over/under` → returns multi-player data for NBA ✓
- `freeThrowsAttempted-PLAYER_ID-game-ou-over/under` → no data returned for NBA — omitted from constants
- `statEntityID` in responses = real playerID (e.g., `BRANDON_LOWE_1_MLB`), never literal `PLAYER_ID`

#### Pinnacle + Player Props
- `bookmakerID=pinnacle` with any PLAYER_ID pattern → empty `byBookmaker` for both MLB and NBA
- Pinnacle confirmed: **zero player-prop data** in SGO
- Code enforces mutual exclusion: when `playerPropOddIdPatterns` is set, `pinnacleOnly` is silently ignored to prevent empty responses

#### Cursor Pagination
- `nextCursor` returned when more pages exist; `null` when final page
- Query params (`startsAfter`, `startsBefore`, `leagueID`, `oddID`, etc.) remain stable across all pages
- Absence of `nextCursor` (or `nextCursor: null`) = end of results

#### Error Handling (per SGO docs)
- 500/503: retry once after ~3s delay — implemented ✓
- 504: log query complexity hint + retry once after ~5s — implemented ✓
- Non-JSON body: retry once (transient), then fail closed — implemented ✓
- 429: use `Retry-After` header, already implemented ✓
- 400/401/403: throw immediately, no retry — already implemented ✓

### Proof Script Results

```
tsx apps/ingestor/src/scripts/verify-utv2-1266.ts

UTV2-1266 verification: ALL ASSERTIONS PASSED
  ✓ includeAltLines absent (live mode)
  ✓ includeAltLines absent (historical mode)
  ✓ includeOpenCloseOdds preserved (historical mode)
  ✓ includeOpposingOdds preserved (live + historical)
  ✓ bookmakerID=pinnacle present when pinnacleOnly=true
  ✓ bookmakerID absent when pinnacleOnly not set
  ✓ pinnacleOnly + historical: no conflict
  ✓ playerPropOddIdPatterns sets oddID param
  ✓ playerPropOddIdPatterns takes precedence over pinnacleOnly
  ✓ pinnacleOnly ignored when playerPropOddIdPatterns set
```

## Verification

**Branch HEAD SHA:** `0b59518203045f1305ae2ea3eb504d80875018b1`

### pnpm verify

All 86 tests pass. pnpm type-check clean. pnpm test 86/86. Build clean.

### pnpm test:db

```
pnpm test:db
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 111012
```

7/7 DB integration tests pass against live Supabase (zfzdnfwdarxucxtaojxm).

### Guardrails

- Public Discord remains gated (UNIT_TALK_ENABLED_TARGETS=none unchanged)
- No CLV/evidence rows mutated
- No WebSocket streaming added
- CLV certification logic unchanged
- Future historical backfills: alt-line contamination eliminated
- Pinnacle player-prop guard enforced in code (not just docs)
- Usage monitoring: raw response redacted before any logging via `sanitizeSGOUsageForLog`
