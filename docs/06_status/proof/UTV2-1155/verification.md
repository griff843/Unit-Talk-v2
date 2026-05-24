# UTV2-1155 Verification Log

Date: 2026-05-24
Branch: codex/utv2-1155-clean-remediation
Merge SHA: 3944ec01b6c9935c610bc26b57cbb72549dd06fd
PR: https://github.com/griff843/Unit-Talk-v2/pull/840
Executor: codex

## pnpm type-check

TypeScript project-references build: PASS

## pnpm test

110/110 tests pass (0 failures); 6 targeted ingest-fail-closed tests all pass

## pnpm verify

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
Changed files: 5
Rules matched: ingestor-provider
```

Exit code: 0

## Runtime Evidence

The startup provider-check guard is exercised directly via subprocess tests against the real ingestor module (not mocked). Evidence:

- queries: [collectConfiguredSgoApiKeyCandidates({SGO_API_KEY: undefined}) → length=0; subprocess fork of index.ts with no providers configured → exit code 1]
- row_counts: [ingest cycles completed with no configured provider before guard fires = 0]
- receipts: [ingest-fail-closed.test.ts passed: 6/6 tests green; guard emits fatal JSON with startup_provider_missing; odds-only and non-autorun paths exit cleanly (code 0)]

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
- [x] No old #837 lane metadata, sync files, or package script changes are included in this clean remediation PR
