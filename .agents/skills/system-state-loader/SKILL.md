---
name: system-state-loader
description: DEPRECATED for queue/lane state — current state is live `main`, open PRs, runtime, and docs/mission/plan.md, never Linear (docs/mission/intent.md). Load repo state at session start or after context loss. Use when beginning work, after a reset, or whenever repo, queue, and runtime truth may have drifted from memory.
category: governance
owner: codex
trigger: Beginning work, after reset/context loss, or whenever repo, queue, and runtime truth may have drifted.
---

# System State Loader

Use this at the start of a session, after `/clear`, or when repo truth is uncertain.

Current state is the **repository and its runtime**: `main`, the open PRs, and
`docs/mission/plan.md`. Linear is not consulted — a stale portfolio row must never block or
redirect work that the repository says is live.

## Core workflow

1. Sync, so every later premise is about the real `main`:
```bash
git fetch origin && git status --short --branch
```
2. Read the plan — it is the queue:
```bash
cat docs/mission/plan.md
```
3. Read what is actually in flight:
```bash
gh pr list --state open --json number,title,headRefName,isDraft,mergeStateStatus \
  --jq '.[] | "#\(.number) \(.headRefName) \(.mergeStateStatus)\(.isDraft | if . then " DRAFT" else "" end)  \(.title)"'
git worktree list
```
4. Read runtime health for anything the next step depends on:
```bash
pnpm ops:brief
```

## Confirm three things before proceeding

- the active branch and working-tree state
- the next concrete piece of work, named from `docs/mission/plan.md` or an open PR
- the current blocker, if any

## Stop and reconcile when

- the working tree is dirty on a branch you did not expect
- an open PR and the plan disagree about what is in flight
- `main` has moved under a branch you were about to build on
- you cannot name the next concrete piece of work

## Do not

- run `pnpm linear:work`, or treat Linear as queue truth
- ask for an issue ID, tier label, lane manifest or R-level — mission-native work has none
- infer state from memory or from a previous session's summary when a command can answer

## Reference

Full shared version: [`.claude/commands/legacy/system-state-loader.md`](../../../.claude/commands/legacy/system-state-loader.md)
(legacy; retained for the Linear-era procedure it documents, not as current practice)
