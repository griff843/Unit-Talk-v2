# UTV2-1155 Diff Summary

**Issue:** Ingestor daemon must fail-closed when required provider secrets are missing  
**Tier:** T2  
**Branch:** claude/utv2-1155-ingestor-fail-closed-missing-secrets  
**Status:** Implementation updated for adversarial review findings; full verify green

## Changes

### `apps/ingestor/src/index.ts`
Added startup fail-closed guard before the autorun block:
- When `runtime.autorun === true` AND no SGO credential exists AND `ODDS_API_KEY` is absent
- Daemon logs a fatal JSON message to stderr and calls `process.exit(1)`
- Odds API-only autorun remains valid unless PM ratifies "SGO required for all autorun"
- Container shows `Exited (1)` only when no provider mode is configured

### `apps/ingestor/src/ingest-odds-api.ts`
- `OddsApiIngestOptions.apiKey` typed as `?: string` (was `string`) to match the existing `!apiKey` runtime guard
- Added explicit `logger?.warn?.(...)` when ODDS_API_KEY is absent (was silent skip)

### `apps/ingestor/src/ingest-fail-closed.test.ts` (new)
6 tests covering provider-missing behavior and startup-path enforcement:
1. `ingestLeague returns skipped with warning when SGO_API_KEY is absent`
2. `ingestOddsApiLeague emits warning log when ODDS_API_KEY is absent`
3. `collectConfiguredSgoApiKeyCandidates returns empty array when no SGO env vars set`
4. Subprocess import of `apps/ingestor/src/index.ts` exits non-zero and emits fatal JSON for autorun with no SGO and no Odds API key
5. Subprocess import preserves Odds API-only autorun and does not emit fatal startup JSON
6. Subprocess import preserves non-autorun startup with no SGO key and does not emit fatal startup JSON

## Verification
- Targeted: `tsx --test apps/ingestor/src/ingest-fail-closed.test.ts` PASS, 6/6 tests
- Relevant package: `pnpm --filter @unit-talk/ingestor test` PASS, 110/110 tests
- Full gate: `pnpm verify` PASS
- R-level check: `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` PASS (no matched rules)
