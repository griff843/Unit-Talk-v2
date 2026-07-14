# UTV2-1532 Verification

## Verification

- `npx tsx --test scripts/ops/codex-exec.test.ts` — PASS (13 tests), including the new no-upstream first-push regression case.
- `pnpm type-check` — PASS.
- `pnpm test` — PASS.
- `pnpm verify` — PASS.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no R1–R5 rules matched.

The focused regression creates a bare origin, pushes `main`, switches to a new untracked `codex/...` branch, persists evidence, and verifies both the fresh remote clone and `origin/codex/...` upstream relationship.
