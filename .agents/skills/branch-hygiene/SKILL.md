---
name: branch-hygiene
description: Keep Unit Talk branch, worktree, and staging state clean. Use when splitting mixed work, staging coherent slices, merging finished branches, or pruning stale Codex branches safely.
---

# Branch Hygiene

Use this when repo state is mixed or when finishing a lane.

## Core habits

- one issue or coherent slice per branch
- stage only the intended lane
- verify before commit when feasible
- keep `main` clean and synced
- never delete active worktree branches blindly

## Safe workflow

1. Inspect:
```bash
git status --short
git diff --stat
```
2. Isolate a slice:
```bash
git add <intended files>
git diff --cached --name-only
```
3. Commit on a dedicated `codex/...` branch.
4. After merge, delete only branches fully represented on `main`.

## Never do

- `git reset --hard`
- broad cleanup without a branch/worktree audit
- deleting branches with attached worktrees unless explicitly intended

## Reference

- [CLAUDE.md](C:/Dev/Unit-Talk-v2-main/CLAUDE.md)
