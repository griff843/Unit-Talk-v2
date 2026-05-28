# UTV2-1180 Verification

## Commands

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsx --test apps/api/src/t1-proof-utv2-1109-dual-auth.test.ts apps/api/src/t1-proof-utv2-1110-approval-expiration.test.ts apps/api/src/t1-proof-utv2-1111-governance-rollback.test.ts` | PASS | 49 tests, 0 failures. |
| `rg "\\b(describe\|it)\\s*\\(" apps/api/src/t1-proof-utv2-1109-dual-auth.test.ts apps/api/src/t1-proof-utv2-1110-approval-expiration.test.ts apps/api/src/t1-proof-utv2-1111-governance-rollback.test.ts` | PASS | No `describe()` or `it()` calls remain in the proof suites. |
| `pnpm type-check` | PASS | TypeScript project-reference check passed. |
| `pnpm test` | PASS | Root aggregate tests passed. |
| `pnpm test:db` | PASS | 7 live DB smoke tests passed. |
| `pnpm verify` | PASS | env, lint, type-check, build, test, and verify commands passed. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Changed files matched no R-level rules. |
| `pnpm ops:runtime-health -- --json` | RECORDED | Overall runtime-health returned failed because of pre-existing stale runtime signals; pipeline health was healthy with no pending/failed/dead-letter outbox rows. |

## Verify Tail

```text
> @unit-talk/v2@0.1.0 verify:commands
> pnpm --filter @unit-talk/discord-bot command-manifest:check && node scripts/check-migration-versions.mjs && node scripts/lint-migrations.mjs

> @unit-talk/discord-bot@0.1.0 command-manifest:check
> tsx scripts/sync-command-manifest.ts --check

[command-manifest] Verified 14 command definition(s) against apps/discord-bot/command-manifest.json
[check-migration-versions] 114 migration file(s) verified - no duplicate versions.
[lint-migrations] 114 migration file(s) checked - no findings.
```

## Runtime Health Note

`pnpm ops:runtime-health -- --json` returned exit 1. The failing checks were stale worker/provider/scheduler/delivery timestamps in the shared runtime environment. The pipeline section was healthy: no dead-letter rows, no failed rows, no pending target backlog, and `silent_stranding_risk=false`.
