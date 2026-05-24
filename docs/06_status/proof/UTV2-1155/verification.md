# UTV2-1155 Verification Log

Date: 2026-05-24
Branch: claude/utv2-1155-ingestor-fail-closed-missing-secrets
Executor: codex

## Targeted startup test

```
tsx --test apps/ingestor/src/ingest-fail-closed.test.ts
# tests 6
# pass 6
# fail 0
```

Exit code: 0

## Relevant package test

```
pnpm --filter @unit-talk/ingestor test
# tests 110
# pass 110
# fail 0
```

Exit code: 0

## Full gate

```
pnpm verify
[sync-check] OK (per-issue): branch "claude/utv2-1155-ingestor-fail-closed-missing-secrets" <-> .ops/sync/UTV2-1155.yml
[system-alignment] verdict=PASS fail=0 warn=0
[automation-coverage] verdict=PASS fail=0 warn=0 classified=15
Environment files passed validation.
[command-manifest] Verified 14 command definition(s) against apps/discord-bot/command-manifest.json
[check-migration-versions] 109 migration file(s) verified — no duplicate versions.
[lint-migrations] 109 migration file(s) checked — no findings.
```

Exit code: 0

## R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 11
Rules matched: (none) — no R-level artifacts required for this diff
```

Exit code: 0

## Verification

- [x] Daemon exits non-zero on startup when no provider mode is configured
  - Guard: `runtime.autorun && runtime.sgoApiKeys.length === 0 && !runtime.oddsApiKey` → `process.exit(1)` in `apps/ingestor/src/index.ts`
- [x] Fatal stderr JSON is limited to the truly invalid missing-provider path
  - Subprocess test asserts `status: fatal`, `startup_provider_missing`, and both providers missing
- [x] Odds API-only autorun is preserved
  - Subprocess test asserts exit code 0 and no fatal startup JSON when `ODDS_API_KEY` is set without SGO keys
- [x] Non-autorun without SGO is preserved
  - Subprocess test asserts exit code 0 and no fatal startup JSON when autorun is false
- [x] No replay, outbox, lifecycle, settlement, DB schema, or queue paths touched
