# UTV2-1155 Diff Summary

**Issue:** Ingestor daemon must fail-closed when required provider secrets are missing  
**Tier:** T2  
**Branch:** codex/utv2-1155-clean-remediation  
**Merge SHA:** `3944ec01b6c9935c610bc26b57cbb72549dd06fd`  
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/840  
**Status:** Merged

## Changes

### `apps/ingestor/src/index.ts`
Narrowed the already-merged startup fail-closed guard before the autorun block:
- When `runtime.autorun === true` AND no SGO credential exists AND `ODDS_API_KEY` is absent
- Daemon logs a fatal JSON message to stderr and calls `process.exit(1)`
- Odds API-only autorun remains valid unless PM ratifies "SGO required for all autorun"
- Container shows `Exited (1)` only when no provider mode is configured

### `apps/ingestor/src/ingest-fail-closed.test.ts`
Expanded the merged fail-closed test file to 6 tests covering provider-missing behavior and startup-path enforcement:
1. `ingestLeague returns skipped with warning when SGO_API_KEY is absent`
2. `ingestOddsApiLeague emits warning log when ODDS_API_KEY is absent`
3. `collectConfiguredSgoApiKeyCandidates returns empty array when no SGO env vars set`
4. Subprocess import of `apps/ingestor/src/index.ts` exits non-zero and emits fatal JSON for autorun with no SGO and no Odds API key
5. Subprocess import preserves Odds API-only autorun and does not emit fatal startup JSON
6. Subprocess import preserves non-autorun startup with no SGO key and does not emit fatal startup JSON

### Proof Files
- Updated this proof packet to distinguish merged #837 behavior from this clean remediation PR.
- No lane metadata, sync files, package scripts, replay, outbox, lifecycle, settlement, queue, or schema files are changed by this remediation PR.

## Verification
- Targeted: `tsx --test apps/ingestor/src/ingest-fail-closed.test.ts`
- Relevant package: `pnpm --filter @unit-talk/ingestor test`
- Full gate: `pnpm verify`
- R-level check: `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` PASS (`ingestor-provider`)
