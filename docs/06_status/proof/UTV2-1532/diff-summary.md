# UTV2-1532 Diff Summary

- Updated `scripts/ops/codex-exec.ts` so model-routing evidence is pushed with an explicit `origin HEAD:refs/heads/<current-branch>` refspec and `--set-upstream`.
- Added regression coverage that starts with a lane branch that has no upstream, then verifies the evidence is present on the remote branch and the upstream was established.

This fixes the first-push failure for branches created locally by `git worktree add -b`.
