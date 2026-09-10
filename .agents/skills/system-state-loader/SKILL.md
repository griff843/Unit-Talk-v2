---
name: system-state-loader
description: Load current Unit Talk repo state at session start or after context loss. Use when beginning work, after a reset, or whenever repo, queue, and runtime truth may have drifted from memory.
category: governance
owner: codex
trigger: Beginning work, after reset/context loss, or whenever repo, queue, and runtime truth may have drifted.
---

# System State Loader

Use this at the start of a session, after `/clear`, or when repo/queue truth is uncertain.

## Core workflow

1. Run:
```bash
pnpm ops:brief
```
2. Read mission intent/spec/plan and the assigned `.ops/work/<ID>.md` contract, then read the output fully before acting. Tracker access is never required, including when credentials are configured.
3. If the task is queue or branch related, also inspect:
```bash
pnpm ops:execution-state
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
- manifest, lease, worktree or PR state conflicts with repo truth
- mainline health is unclear
- you cannot name the next concrete lane

## Reference

For the full shared team version, read:
- [`.claude/commands/system-state-loader.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/system-state-loader.md)
