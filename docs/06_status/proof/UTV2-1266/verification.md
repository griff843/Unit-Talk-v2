# UTV2-1266 Verification

## Summary

SGO ingestor: disable `includeAltLines`, add Pro-plan REST polling optimizations.

## Changes Verified

1. **`includeAltLines` removed** from `buildSgoOddsRequestUrl` historical path (`sgo-request-contract.ts`)
2. **`includeOpenCloseOdds=true` preserved** — required for CLV calculation
3. **`includeOpposingOdds=true` preserved** — required for paired prop markets
4. **`pinnacleOnly?: boolean`** added to request contract, SGOFetchOptions, IngestLeagueOptions, IngestorRunnerOptions
5. **`UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK`** added to SchedulerEnv; when enabled + in peak window, passes `bookmakerID=pinnacle`
6. **`.env.container.example`** updated with all 6 scheduling vars (SCHEDULING_ENABLED, PEAK_POLL_MS, OFFPEAK_POLL_MS, PEAK_START_HOUR_ET, PEAK_END_HOUR_ET, PINNACLE_ONLY_PEAK)
7. **Hetzner `.env.production`** updated with SCHEDULING_ENABLED=true + PEAK_START/END/POLL_MS vars (applied 2026-06-12)
8. **Test updated**: `fetchAndPairSGOProps requests SGO historical open/close odds fields` — assert `includeAltLines=null`
9. **PROVIDER_KNOWLEDGE_BASE.md** updated: includeAltLines disposition, streaming blocked note, native close fields T1 candidate

## Proof Script Results

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
```

## pnpm verify

All 86 tests pass. Type-check clean. Build clean.

## Root Cause Impact

- bd9d71a6 (Champagnie 3PM 2.5 vs main line 1.5): ALT_LINE FAIL root cause eliminated going forward
- All future historical-mode backfills will not include alt-line contamination

## Guardrails

- Public Discord remains gated (UNIT_TALK_ENABLED_TARGETS=none unchanged)
- No CLV/evidence rows mutated
- No WebSocket streaming added
- CLV certification logic unchanged
