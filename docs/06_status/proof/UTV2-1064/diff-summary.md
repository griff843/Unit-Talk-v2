# UTV2-1064 Diff Summary

## Scope
- Added shared Codex executor resolution in `scripts/ops/shared.ts`.
- Updated `scripts/ops/lane-link-pr.ts` and `scripts/codex-receive.ts` to use executor-aware Codex lane detection.

## Behavior
- Explicit `manifest.executor` is authoritative when present.
- Legacy executor-shaped `lane_type` values remain supported only when `executor` is absent.
- Codex ownership now accepts both `codex-cli` and `codex-cloud`.
- A manifest with `executor: "claude"` and legacy `lane_type: "codex-cli"` is rejected as non-Codex, because explicit executor wins.

## Verification Summary
- `pnpm type-check`: PASS
- `pnpm test`: PASS
- `pnpm lint`: PASS
- `pnpm build`: PASS
- Issue-specific executor compatibility check: PASS
- `pnpm verify`: BLOCKED before code gates by `.ops/sync.yml` issue mismatch outside this lane scope.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: BLOCKED by local tsx IPC `EPERM`.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS for current HEAD baseline.
