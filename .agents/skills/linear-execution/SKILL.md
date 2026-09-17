---
name: linear-execution
description: Use Unit Talk's CLI-first queue flow when a task explicitly depends on Linear issue state. Use when asked to read, update, close, or reconcile Linear execution lanes from the repo.
category: governance
owner: codex
trigger: Task explicitly depends on reading, updating, closing, or reconciling Linear issue state.
---

# Linear Execution

Use this only when the user explicitly requests optional Linear inspection or mirroring. Ordinary discovery, admission, execution, review, integration and closeout use repository authority and never require this skill. A token being present is not a request.

## Default commands

```bash
pnpm linear:work
pnpm linear:issues
pnpm linear:update -- <issue-id> --state <state>
pnpm linear:comment -- <issue-id> --body "<summary>"
pnpm linear:close -- <issue-id> --comment "<closeout>"
```

## Rules

- treat Linear as an optional mirror; mission, local work contracts, manifests, GitHub and runtime evidence remain authoritative
- do not update issue state blindly if branch or PR truth disagrees
- prefer Claude for broad queue orchestration; use this skill for explicit execution support

## Reference

- [`.claude/commands/dispatch-board.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/dispatch-board.md) — autonomous board loop (supersedes the old linear-sync flow)
