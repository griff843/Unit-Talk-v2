# UTV2-1070 Diff Summary

**Merge SHA:** 8e7273f9b7c7e1beb509de4644731ec4143a12db

## Summary

- Added worktree-local pnpm and Corepack state isolation for lane setup installs launched by `scripts/ops/lane-start.ts`.
- Routed both new-lane and resumed-lane setup through the isolated pnpm runner.
- Kept state rooted under each lane worktree at `.out/pnpm-state` so parallel lane starts do not share pnpm home, cache, store, state, or Corepack directories.

## Files changed

- `scripts/ops/lane-start.ts`: wraps lane setup installs with pnpm/Corepack environment variables that point at worktree-local state directories.
- `scripts/ops/codex-exec.ts`: applies the same pnpm state isolation to Codex child process spawns via `buildCodexChildEnv`.
- `scripts/ops/codex-wrapper.ts`: applies the same pnpm state isolation to the Codex wrapper spawn.
- `docs/06_status/proof/UTV2-1070/diff-summary.md`: records this implementation scope.
- `docs/06_status/proof/UTV2-1070/verification.md`: records required verification results.

## Scope notes

- No lifecycle, domain, database, migration, delivery, or runtime application paths changed.
- No R-level rules in `docs/05_operations/r1-r5-rules.json` match the intended changed paths.
- The proof files are included because UTV2-1070 explicitly required `docs/06_status/proof/UTV2-1070/diff-summary.md` and `verification.md`.
