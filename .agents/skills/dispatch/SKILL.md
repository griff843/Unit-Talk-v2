---
name: dispatch
description: DEPRECATED — lane dispatch from a Linear queue is superseded (docs/mission/intent.md). Work now arrives as a work packet run by `pnpm ops:codex-packet`; see AGENTS.md -> Work Unit Contract. Invoking this skill returns the replacement route; it does not dispatch a lane.
category: governance
owner: codex
trigger: User asks for /dispatch, queue dispatch, Codex lane dispatch, or one-command Linear issue execution.
---

# Dispatch — DEPRECATED, do not execute

**Do not run any lane-dispatch command from this skill.** The execution model it
drove — a Linear issue routed into a lane, a lane manifest, a tier label, a
lane-scoped closeout — is superseded by `docs/mission/intent.md` and the Work
Unit Contract in `AGENTS.md`. Leaving the operative body in place made this an
active route back into the superseded model, which is the one thing a
deprecation notice in the front matter cannot prevent.

If you were sent here by `/dispatch`, by a request for queue dispatch, or by a
request to run a Linear issue into a lane, answer with the replacement route
below and stop. Do not run `codex:dispatch`, `codex:classify`, `codex:status`,
`codex:receive`, `ops:lane-start`, or `ops:lane-finalize` on its behalf.

## The replacement

Work arrives as a **work packet**, not a queue item. A packet is a file — start
from `docs/mission/packets/TEMPLATE.md` — carrying `## Goal`, `## Scope`,
`## Acceptance` and `## Do not touch`. It is run in an isolated worktree:

```bash
git worktree add ../wt-<name> -b <branch> origin/main
pnpm ops:codex-packet --packet docs/mission/packets/<packet>.md --cwd ../wt-<name>
```

The runner refuses the primary (control) checkout, a detached HEAD and `main`,
classifies the packet's declared scope against
`docs/05_operations/RESERVED_RISK_SURFACES.json`, and selects the model profile
from that classification.

## Where the old steps went

| Old step | Now |
|---|---|
| queue selection from Linear | the packet itself; there is no queue |
| `--tier T1/T2/T3` | reserved-surface classification: `pnpm ops:classify-diff` |
| lane manifest + `ops:lane-start` | an isolated worktree and a branch |
| `codex:receive`, lane review state | the PR |
| `ops:lane-finalize` closeout | merge, governed by `.github/workflows/merge-gate.yml` |

## Reviewing returned work

Use the `codex-return-reviewer` agent. It checks the returned diff against the
packet's declared scope and against the reserved surfaces — not against a lane
manifest, tier label or R-level, none of which exist any more.
