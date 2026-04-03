---
name: merge-conflict-resolution
description: Resolve Unit Talk merge conflicts safely. Use when merging feature branches into main or another integration branch, especially across shared tests, promotion logic, routing, or runtime code.
---

# Merge Conflict Resolution

Use this when a merge stops on a real conflict.

## Priorities

1. preserve both valid behaviors when they are additive
2. preserve repo invariants over branch loyalty
3. run focused tests before completing the merge

## Workflow

1. Identify conflicted files:
```bash
git status --short
```
2. Read the exact conflict region and the surrounding code.
3. Resolve in favor of:
   - lifecycle invariants
   - domain purity
   - delivery/outbox invariants
   - already-landed `main` truth unless the branch intentionally supersedes it
4. Stage conflicted files.
5. Run the smallest focused tests that cover the conflict.
6. Complete the merge only after those tests pass.

## Reference

- [`.agents/skills/betting-domain/SKILL.md`](C:/Dev/Unit-Talk-v2-main/.agents/skills/betting-domain/SKILL.md)
- [`.agents/skills/pick-lifecycle/SKILL.md`](C:/Dev/Unit-Talk-v2-main/.agents/skills/pick-lifecycle/SKILL.md)
- [`.agents/skills/outbox-worker/SKILL.md`](C:/Dev/Unit-Talk-v2-main/.agents/skills/outbox-worker/SKILL.md)
