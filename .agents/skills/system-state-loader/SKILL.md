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

## Reconcile the affected work when

- a required state read fails or conflicts with current PR, manifest, lease or worktree evidence
- the proposed task lacks an actionable contract or has an unresolved dependency

Identify whether the failure blocks this task or only unrelated work. Preserve required admission controls and continue independent authorized work. A historical plan or lesson is not evidence that a merged PR still holds an active lock. Distinguish integrated, deployed and user-verified status.

## Reference

For the full shared team version, read:
- [`.claude/commands/system-state-loader.md`](../../../../.claude/commands/system-state-loader.md)
