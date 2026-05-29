## Summary

- Added explicit `ops:lane-start --executor` validation in `scripts/ops/lane-start.ts`.
- Bare `codex` is rejected as a routing label; accepted lane executors are `claude`, `codex-cli`, and `codex-cloud`.
- Updated `/three-brain` to emit concrete lane executors for dispatch and to describe Explore/QA/Griff as non-lane actions.
- Updated `/dispatch` Phase 1 and Phase 4 so Explore/QA/Griff cannot be passed into `ops:lane-start` and Codex Cloud has an explicit fail-closed branch.

## Files Changed

- `.claude/commands/dispatch.md` — documents concrete executor values, non-lane Explore/QA/Griff handling, and Codex Cloud dispatch behavior.
- `.claude/commands/three-brain.md` — changes the output contract from bare `codex`/Explore/QA values to concrete lane executors and non-lane action guidance.
- `scripts/ops/lane-start.ts` — adds `validateLaneExecutor()` and applies it before lane-start can create a worktree, reserve a lease, or write a manifest.

## Scope Note

Closeout inspection found the original lane worktree already contained local-only commits ahead of `origin/main` for UTV2-1186, UTV2-1187, and UTV2-1188. Those files were pre-existing lane history, not part of this implementation. To keep the PR scoped, the PR branch was prepared from `origin/main` with only the files listed above plus this proof bundle.

## SHA Binding
merge_sha: 5426e1c3cf222e54c7eded4a2f32e5e5f65788f8
