---
name: system-state-loader
description: Load current Unit Talk repo state at session start or after context loss. Use when beginning work, after a reset, or whenever repo, queue, and runtime truth may have drifted from memory.
---

# System State Loader

Use this at the start of a session, after `/clear`, or when repo/queue truth is uncertain.

## Core workflow

1. Run:
```bash
pnpm ops:brief
```
2. Read the output fully before acting.
3. If the task is queue or branch related, also inspect:
```bash
pnpm linear:work
pnpm github:current
```
4. Confirm three things before proceeding:
   - active branch and repo state
   - executable issue or requested task
   - current blocker, if any

## Proceed only when

- repo state is clear
- the issue or task is clear
- no stale branch/queue conflict blocks execution

## Stop and reconcile when

- `ops:brief` fails
- Linear state conflicts with repo truth
- mainline health is unclear
- you cannot name the next concrete lane

## Reference

For the full shared team version, read:
- [`.claude/commands/system-state-loader.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/system-state-loader.md)
