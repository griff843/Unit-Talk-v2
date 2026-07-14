# UTV2-1484 Verification

## Verification

- `npx tsx --test apps/command-center/src/app/api/governance/lanes/route.test.ts` — PASS (2 tests).
- `pnpm test:command-center` — PASS (116 tests).
- `pnpm type-check` — PASS.
- `pnpm lint` — PASS.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no rules matched.
- `pnpm qa:experience --regression --mode fast` — SKIP: the local Command Center and operator-web routes were not running. The generated QA artifact records all three failed reachability preflight checks; the R-level gate accepts the artifact and passes.
- `pnpm verify` — PASS.
