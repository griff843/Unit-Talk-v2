# UTV2-1275 — Diff Summary (Wave 1)

Restore SGO MLB player-prop ingestion by splitting the single SGO odds request into a
game-line fetch and a dedicated player-prop fetch.

## Root cause fixed

Production runs the ingestor with `UNIT_TALK_INGESTOR_SCHEDULING_ENABLED=true` and
`UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK=true` (deploy.yml). The single SGO odds request
collapsed to `bookmakerID=pinnacle` during peak windows; Pinnacle carries no MLB player
props, so props were filtered out before entering the DB. The PLAYER_ID wildcard fetch
path existed but was never wired into the runner.

## Changed (apps/ingestor)

- `sgo-request-contract.ts` — add `includeOpenCloseOdds` option for live fetches; the
  existing `playerPropOddIdPatterns` already sets `oddID` and ignores `pinnacleOnly`.
- `sgo-fetcher.ts` — forward `playerPropOddIdPatterns` + `includeOpenCloseOdds` through
  `SGOFetchOptions` to the request builder.
- `ingest-league.ts` — issue a SECOND, dedicated player-prop request (PLAYER_ID patterns,
  never Pinnacle-only, `includeOpenCloseOdds`) on live ingest, and merge its paired props
  with the game-line result before normalization (`mergeSgoFetchResults`). Game-line fetch
  keeps Pinnacle-only peak behavior.
- `ingestor-runner.ts` — pass `SGO_PLAYER_PROP_ODD_ID_PATTERNS[league]` to `ingestLeague`
  every cycle regardless of peak/pinnacle, so props are ingested fresh each cycle.

## Tests

- `player-prop-ingest.test.ts` (new) — contract: prop request uses PLAYER_ID + is never
  Pinnacle-only + includeOpenCloseOdds; parser/normalizer: MLB batting prop preserves
  `provider_participant_id`; ingest-league: a separate non-Pinnacle prop request is issued
  every cycle even under peak Pinnacle-only (freshness).
- `ingestor.test.ts` — updated the rate-limit telemetry test's request count to include the
  new player-prop fetch (backoff assertions unchanged).
- `package.json` — registered the new test file in `test:apps-rest`.

## Freshness

No freshness gate was loosened. Props now refresh every cycle (poll interval ≪ the 3h
freshness threshold) because the prop fetch is no longer suppressed by peak Pinnacle-only
polling.

## Scope boundary

No schema/migration (canonical identity persistence is Wave 3 / UTV2-1277). No production
data mutation; no backfill; no scoring/promotion/candidate-semantics changes.

## Credit note

The dedicated prop fetch is restricted to the MLB PLAYER_ID `oddID` patterns (4 batting
stats × over/under), bounding payload/credit cost vs a full-odds fetch.
