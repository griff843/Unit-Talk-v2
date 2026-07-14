# UTV2-1531 Verification

## Verification

Commands run from the UTV2-1531 lane worktree:

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsx --test scripts/ops/shared.test.ts scripts/ci/file-scope-guard.test.ts` | PASS | 56 tests passed, including DEBT-030 and DEBT-031 regressions. |
| `npx tsx scripts/ci/file-scope-guard.ts --base origin/main --head HEAD --branch codex/utv2-1531-debt-030-031-file-scope --manifest-source git` | PASS | Current branch has no scope violations or active-lock conflicts. |
| `pnpm type-check` | PASS | TypeScript project-references check completed. |
| `pnpm test` | PASS | Root aggregate test suite completed. |
| `pnpm verify` | PASS | Full repository gate completed, including static checks and live-DB smoke tests. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | 10 changed files; no R-level rules matched and no artifacts are required. |

`pnpm test:db` is not required for this T2 scripts-only change; no migration, `packages/db/**`, or API service file changed.
