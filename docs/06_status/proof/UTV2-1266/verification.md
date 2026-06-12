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
```

## Verification

**Branch HEAD SHA:** `296671de13bb6f7db3f5c7397c9c300fe765448d`

### pnpm verify

All 86 tests pass. pnpm type-check clean. pnpm test 86/86. Build clean.

### pnpm test:db

```
pnpm test:db
# tests 7
# pass 7
# fail 0
# duration_ms ~111000
```

7/7 DB integration tests pass against live Supabase (zfzdnfwdarxucxtaojxm).

### Guardrails

- Public Discord remains gated (UNIT_TALK_ENABLED_TARGETS=none unchanged)
- No CLV/evidence rows mutated
- No WebSocket streaming added
- CLV certification logic unchanged
- Future historical backfills: alt-line contamination eliminated
