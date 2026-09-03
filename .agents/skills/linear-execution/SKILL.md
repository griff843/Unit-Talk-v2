---
name: linear-execution
description: DEPRECATED and READ-ONLY. Linear is portfolio history, not execution authority (docs/mission/intent.md). Use only to READ or reconcile historical Linear state against repo truth. Never use it to admit, decide, update, or close work — a request to change Linear state is refused here, not routed here.
category: governance
owner: codex
trigger: Task explicitly depends on READING historical Linear issue state, or on reconciling it against GitHub and repo truth.
---

# Linear Execution (read-only)

Linear records what the portfolio used to look like. It does not admit work, does not decide
what is Done, and is not queue truth. This skill exists so that historical state can be read
and reconciled — not so it can be edited.

## Allowed commands

```bash
pnpm linear:work      # read the historical queue view
pnpm linear:issues    # read issue state
```

That is the whole list.

## Refused here

`linear:update`, `linear:comment` and `linear:close` are NOT part of this skill. If a task
asks to move, comment on, or close a Linear issue, say plainly that Linear is no longer
execution authority and that changing it would write a status the mission does not derive
from. If a human wants the record updated anyway, that is their call to make in Linear
directly — it is not a step in any execution path, and no gate reads the result.

The earlier version of this file both declared itself deprecated and listed the three
mutating commands as its "default commands". A skill that says read-only in its description
and mutates in its body is worse than one that does neither, because the description is what
gets read when routing.

## Rules

- Repo, branch and GitHub state are truth. Linear is a record of what someone once typed.
- Where they disagree, the repo wins and Linear is simply stale. Do not "fix" Linear to
  match; note the divergence and move on.
- Never gate, block, or unblock work on a Linear value.

## Reference

- [`.claude/commands/legacy/dispatch-board.md`](../../../.claude/commands/legacy/dispatch-board.md) — the retired board loop, kept for reading historical lanes
