# UTV2-1466 Diff Summary

## Summary

- `scripts/ops/lane-start.ts` now keeps lane pnpm home/cache/state/corepack isolated without setting a per-worktree `NPM_CONFIG_STORE_DIR`, so lanes can use the shared pnpm store while preserving isolated install state.
- `scripts/ops/lane-maximizer.ts` no longer blocks package-touching candidates solely because another unrelated lane is active. Existing overlap, singleton lane type, forbidden-combination, migration, and Tier C risk handling remain in force.
- `scripts/ops/lane-maximizer.test.ts` covers the relaxed package-touching recommendation and the lane-start shared-store environment behavior.

## Files Changed

- `scripts/ops/lane-start.ts`: exports `buildPnpmStateEnv()` for coverage and removes private pnpm store overrides from the lane-start install environment.
- `scripts/ops/lane-maximizer.ts`: removes the `ISOLATED_INSTALL_REQUIRED` active-lane block from recommendation evaluation.
- `scripts/ops/lane-maximizer.test.ts`: updates the package-touching lane expectation and adds a regression test for shared pnpm store env handling.

## Scope Notes

- No runtime application code changed.
- No DB schema, migrations, generated DB types, or Tier C runtime paths changed.
- Proof docs were added because the execution packet explicitly required `docs/06_status/proof/UTV2-1466/diff-summary.md` and `docs/06_status/proof/UTV2-1466/verification.md`.
