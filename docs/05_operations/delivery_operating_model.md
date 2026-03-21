# Delivery Operating Model

This document defines how `unit-talk-v2` stays coherent across repo docs, Notion, Linear, Slack, and chat threads.

## System Of Record

### Repo Docs

Repo docs are the architecture and implementation truth.

Use repo docs for:
- contracts
- active roadmap
- routing policy
- environment rules
- current checkpoint state

Authoritative files:
- `docs/06_status/status_source_of_truth.md` — single program state source of truth; wins within Tier 5
- `docs/05_operations/docs_authority_map.md` — tier assignments and conflict resolution rules for all docs
- `docs/04_roadmap/active_roadmap.md`
- `docs/06_status/current_phase.md`
- `docs/06_status/system_snapshot.md`
- contract docs under `docs/02_architecture/contracts/`

Authority tiers and conflict resolution: `docs/05_operations/docs_authority_map.md`

### Notion

Notion is the durable planning and checkpoint layer.

Use Notion for:
- weekly status
- milestone checkpoint summaries
- decision log
- risk register
- migration ledger

Rule:
- if a major checkpoint is claimed in chat, it should be reflected in Notion shortly after

### Linear

Linear is the active execution queue.

Use Linear for:
- issues
- milestones
- sequencing
- active ownership
- blocked state

Rule:
- if engineering work is active, the corresponding issue or milestone state should exist in Linear

### Slack

Slack is execution communication, not truth storage.

Use Slack for:
- coordination
- alerts
- approvals
- operational callouts

Rule:
- decisions made in Slack must be reflected in Notion or repo docs

## Chat Continuity Rule

Chat threads are not durable planning artifacts.

If a new chat starts, the new chat should be grounded from:
1. `docs/06_status/status_source_of_truth.md` — current state, kill conditions, blockers
2. `docs/04_roadmap/active_roadmap.md`
3. `docs/06_status/current_phase.md`
4. `docs/06_status/system_snapshot.md`
5. the relevant contract docs for the slice being worked

Never assume the new chat remembers unwritten decisions.

## Build Order Rule

For every new slice:
1. identify the governing docs
2. patch the docs if they are incomplete
3. implement the slice
4. verify the slice
5. patch status docs
6. sync Notion and Linear

If steps 5 and 6 are skipped repeatedly, the repo is drifting even if the code is good.

## Lane Ownership

### Codex

Best used for:
- implementation
- integration
- runtime wiring
- tests
- keeping the repo green while shipping

### Claude

Best used for:
- bounded hardening work
- contradiction finding
- checkpoint review
- proof-oriented follow-through
- governance/doc ratification work

Rule:
- avoid giving both tools the same coding lane at the same time
- prefer a split of implementation versus review/hardening/governance

## Required Updates At Milestone Boundaries

At the end of a meaningful slice, update:
- `docs/06_status/current_phase.md`
- `docs/06_status/system_snapshot.md`
- `docs/04_roadmap/active_roadmap.md` if sequencing changed
- Notion weekly/checkpoint page
- Linear issue or milestone state

## Current Operating Gap

The current repo is ahead of Linear and Notion discipline.

That is manageable only if this operating model is followed from this point forward.
