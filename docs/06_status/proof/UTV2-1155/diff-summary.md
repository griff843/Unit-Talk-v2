# UTV2-1155 Diff Summary

**Issue:** Ingestor daemon must fail-closed when required provider secrets are missing  
**Tier:** T2  
**Branch:** claude/utv2-1155-ingestor-fail-closed-missing-secrets  
**Status:** Implementation complete, pnpm verify green

## Changes

### `apps/ingestor/src/index.ts`
Added startup fail-closed guard before the autorun block:
- When `runtime.autorun === true` AND `runtime.sgoApiKeys.length === 0`
- Daemon logs a fatal JSON message to stderr and calls `process.exit(1)`
- Container shows `Exited (1)` instead of running while ingesting nothing

### `apps/ingestor/src/ingest-odds-api.ts`
- `OddsApiIngestOptions.apiKey` typed as `?: string` (was `string`) to match the existing `!apiKey` runtime guard
- Added explicit `logger?.warn?.(...)` when ODDS_API_KEY is absent (was silent skip)

### `apps/ingestor/src/ingest-fail-closed.test.ts` (new)
3 tests covering the startup secret-check path:
1. `ingestLeague returns skipped with warning when SGO_API_KEY is absent`
2. `ingestOddsApiLeague emits warning log when ODDS_API_KEY is absent`
3. `collectConfiguredSgoApiKeyCandidates returns empty array when no SGO env vars set` — this is the exact condition checked by the startup guard

## Verification
- `pnpm verify`: 113/113 tests PASS, 0 failures
- `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS (no R-level artifacts required for ingestor-provider rule)
