---
name: linear-execution
description: Use Unit Talk's CLI-first queue flow when a task explicitly depends on Linear issue state. Use when asked to read, update, close, or reconcile Linear execution lanes from the repo.
category: governance
owner: codex
trigger: Task explicitly depends on reading, updating, closing, or reconciling Linear issue state.
---

# Linear Execution

Use this only when the task explicitly depends on Linear state.

## Default commands

```bash
pnpm linear:work
pnpm linear:issues
pnpm linear:update -- <issue-id> --state <state>
pnpm linear:comment -- <issue-id> --body "<summary>"
pnpm linear:close -- <issue-id> --comment "<closeout>"
```

## Rules

- treat Linear as queue truth, but verify against repo/branch reality
- do not update issue state blindly if branch or PR truth disagrees
- prefer Claude for broad queue orchestration; use this skill for explicit execution support

## Reference

- [`.claude/commands/dispatch-board.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/dispatch-board.md) — autonomous board loop (supersedes the old linear-sync flow)
