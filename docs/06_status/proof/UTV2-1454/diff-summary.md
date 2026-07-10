# UTV2-1454 Diff Summary

Date: 2026-07-09

## Summary

- Added an explicit `--docs-only-fast-path` path to `scripts/ops/preflight.ts` that is fail-closed to T3 lanes and limited to `docs/06_status/**` plus `.claude/commands/*.md`.
- Added the matching `scripts/ops/lane-start.ts` validator path that skips worktree, manifest, lease, sync, and proof scaffolding only after tier, scope, branch, and preflight-token checks pass.
- Updated dispatch and lane-management command docs so future T3 docs/status-only lanes can use the fast path without bypassing CI, branch discipline, lane authority, merge gates, tier labels, or Linear auto-close.
- Added source-level regression coverage in `scripts/ops/preflight.test.ts` and `scripts/ops/lane-start.test.ts`.

## Files Changed

- `.claude/commands/dispatch.md` documents the T3 docs-only fast path and the replacement preflight/lane-start commands.
- `.claude/commands/lane-management.md` documents the same exception in lane management terms and keeps it fail-closed.
- `scripts/ops/preflight.ts` adds fast-path flag parsing, path validation, and PB1/PB2 ceremony skips for valid T3 docs-only work.
- `scripts/ops/preflight.test.ts` covers the preflight source contract for the new flag, T3 restriction, allowed paths, and skip messaging.
- `scripts/ops/lane-start.ts` adds the fast-path lane-start validator and returns before creating lane substrate when validated.
- `scripts/ops/lane-start.test.ts` covers the lane-start source contract for T3 restriction, token validation, allowed paths, and skipped ceremony.

## Notes

- This implementation keeps the current UTV2-1454 lane as a normal T2 implementation lane. The new fast path is only available to future T3 docs/status-only lanes that explicitly pass `--docs-only-fast-path`.
