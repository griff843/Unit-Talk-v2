---
name: system-state-loader
description: Load local Unit Talk repo state at session start or after context loss; add remote/runtime state only when the task needs it.
category: governance
owner: codex
trigger: Beginning work, after reset/context loss, or when local repo state may have drifted.
---

# System State Loader

Use this at the start of a session, after `/clear`, or when repo/queue truth is uncertain.

## Core workflow

1. For ordinary code, review, and static-analysis work, run:
```bash
pnpm ops:brief -- --static
```
2. Read the output fully before acting.
3. Run full `pnpm ops:brief` only when the task needs tracker, PR, runtime,
   database, production, or proof truth.
4. If the task is specifically queue or branch related, also inspect:
```bash
pnpm linear:work
pnpm github:current
```
5. Confirm three things before proceeding:
   - active branch and repo state
   - executable issue or requested task
   - current blocker, if any

## Proceed only when

- repo state is clear
- the issue or task is clear
- no stale branch/queue conflict blocks execution

## Stop and reconcile when

- the applicable static or full `ops:brief` fails
- Linear state conflicts with repo truth
- mainline health is unclear
- you cannot name the next concrete lane

## Reference

For the full shared team version, read:
- [`.claude/commands/system-state-loader.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/system-state-loader.md)
