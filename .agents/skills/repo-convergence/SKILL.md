---
name: repo-convergence
description: Converge Unit Talk repo state after parallel work. Use when reconciling branches, merged work, local-only commits, stale remote refs, or deciding what can safely be merged or retired.
---

# Repo Convergence

Use this after heavy parallel execution or when repo state feels fragmented.

## Workflow

1. verify current truth:
```bash
git status --short --branch
git branch -vv
git worktree list
git remote -v
```
2. identify:
   - what is already on `main`
   - what is local-only
   - what is remote-only
   - what has active worktree attachment
3. merge or back up before deleting anything meaningful
4. prune only merged, unneeded branches

## Rules

- never delete branches with active worktrees blindly
- keep one backup branch when consolidating local `main` history
- fix remote URL drift before large cleanup

## Reference

- [`.agents/skills/branch-hygiene/SKILL.md`](C:/Dev/Unit-Talk-v2-main/.agents/skills/branch-hygiene/SKILL.md)
