# UTV2-1275 — Verification (Wave 1)

Restore SGO MLB player-prop ingestion and identity preservation for forward-flow CLV.

Tier: **T1**. Lane type: runtime (ingestor request construction). PR-head SHA:
`e7d681947856b0e2572f3e2ccd2f6fad2a96e61a` (rebound to the merge SHA post-merge).

## Summary

Production runs the ingestor with `UNIT_TALK_INGESTOR_SCHEDULING_ENABLED=true` and
`UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK=true` (deploy.yml lines 259/264, 418/423). The
single SGO odds request collapsed to `bookmakerID=pinnacle` during peak windows, and
Pinnacle carries no MLB player props — so player props were filtered out before reaching
the DB. The PLAYER_ID-wildcard fetch capability existed but was never wired into the runner.

Wave 1 splits SGO odds fetching into a **game-line fetch** (may stay Pinnacle-only on peak)
and a **dedicated player-prop fetch** (PLAYER_ID `oddID` patterns, never Pinnacle-only,
`includeOpenCloseOdds`), merged before normalization, and fires the player-prop fetch
**every cycle** so props stay fresh within the existing 3h threshold. No freshness gate
was loosened; no schema change (canonical identity persistence is Wave 3 / the schema lane).

## Evidence

- `apps/ingestor/src/sgo-request-contract.ts` — `includeOpenCloseOdds` option for live
  fetches; `playerPropOddIdPatterns` already sets `oddID` and ignores `pinnacleOnly`.
- `apps/ingestor/src/sgo-fetcher.ts` — forwards `playerPropOddIdPatterns` +
  `includeOpenCloseOdds`.
- `apps/ingestor/src/ingest-league.ts` — second player-prop request + `mergeSgoFetchResults`.
- `apps/ingestor/src/ingestor-runner.ts` — passes `SGO_PLAYER_PROP_ODD_ID_PATTERNS[league]`
  every cycle, regardless of peak/Pinnacle.

Required-proof matrix (PM directive):

| Requirement | Status | Evidence |
|---|---|---|
| Fixture SGO sample has true MLB player props | ✅ | `player-prop-ingest.test.ts` batting-prop fixture |
| Generated player-prop request includes PLAYER_ID patterns | ✅ | contract + fetcher tests assert `oddID` contains `PLAYER_ID` |
| Player-prop request is NOT Pinnacle-only | ✅ | tests assert `bookmakerID` is null even with `pinnacleOnly:true` |
| provider_offer rows preserve provider_participant_id (fixture) | ✅ | normalize test: `ALEC_BOHM_1_MLB` preserved |
| market_universe player rows increase / blocker proven | ⏳ | requires a post-deploy live cycle — see "Remaining runtime confirmation" |
| ≥1 non-stale well-formed player-prop candidate / blocker proven | ⏳ | post-deploy live cycle (candidate creation is downstream of ingest) |
| Player-prop fetch runs every cycle (freshness) | ✅ | ingest-league test: separate non-Pinnacle prop request issued under peak Pinnacle-only |
| pnpm verify | ✅ | exit 0 (below) |
| pnpm test:db | ✅ | 7/7 pass (below) |
| Request-contract tests | ✅ | `player-prop-ingest.test.ts` |
| SGO parser/normalizer tests | ✅ | `player-prop-ingest.test.ts` |

## Verification

- `pnpm verify`: **green — exit 0** (sync-check, system-alignment, automation-coverage,
  env:check, lint, type-check, build, full test matrix, smart-form verify, verify:commands;
  104 suites, 0 failures). New + updated ingestor tests run in `test:apps-rest`.
- Focused tests: `tsx --test apps/ingestor/src/player-prop-ingest.test.ts` — 6/6 pass.

### Live-DB proof — `pnpm test:db`

`pnpm test:db` (apps/api database smoke against real Supabase) passed:

```
# tests 7
# pass 7
# fail 0
# skipped 0
# todo 0
# duration_ms 120151
```

## Remaining runtime confirmation (post-deploy, not a code blocker)

The request-construction + parse/normalize fix is proven at code + fixture level. Confirming
that `provider_offer_history` player-rows increase and a non-stale player-prop candidate
appears on a real slate requires a production deploy cycle (this session performs no
production writes per guardrails). That live confirmation is the post-deploy runtime check,
and the front-of-funnel monitor extension (the monitor follow-up lane) will surface it.

## Guardrails honored

No P3 cert; UTV2-1042 not marked Done; no CLV/ROI/edge claims; no public Discord changes;
no production evidence mutation; no live backfill; no fabricated picks; no WebSocket
streaming; freshness gate not loosened; no secrets printed.
