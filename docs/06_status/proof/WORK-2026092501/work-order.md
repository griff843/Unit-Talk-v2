# WORK-2026092501 — tier-c-path-guard sees the absolute paths Claude Code actually passes

Tier: T2 · Lane type: governance · Executor: claude

## Problem

`.claude/hooks/tier-c-path-guard.sh` normalizes a target path only by stripping a
`…/Unit-Talk-v2-main/` prefix. Claude Code's Write/Edit pass absolute paths, so on every real
write the `^supabase/migrations/`, `^packages/domain/src/`, … patterns never match and the hook
exits 0. Verified on `main`: an absolute Tier C path exits 0; the same path relative exits 2.
The Tier C warning is therefore a no-op in practice.

Fixing normalization alone would expose a second defect: the manifest-authorized bypass globs
only `docs/06_status/lanes/UTV2-*.json`, relative to the hook's cwd, and reads the branch from cwd
— not from the worktree that contains the target. Authorized WORK lanes and lane worktrees
would start being refused. Both change together.

## Outcome

1. Resolve the git toplevel from the target (nearest existing ancestor dir), strip `<toplevel>/`.
   A path outside any git toplevel exits 0. Keep the legacy `Unit-Talk-v2-main/` strip as fallback.
2. The authorization lookup runs in that toplevel: its branch, its
   `docs/06_status/lanes/{UTV2,UNI,WORK}-*.json`.
3. Tests in `scripts/ops/workflow-hardening.test.ts` (existing file, already in `test:ops`):
   absolute Tier C path with no lane → 2; relative → 2; absolute non-Tier-C → 0; outside repo → 0;
   authorized WORK manifest on the current branch in a temp repo → 0; same with status done → 2;
   branch mismatch → 2.

## Not in scope
No change to which paths are Tier C, to the warning text, or to any workflow.
