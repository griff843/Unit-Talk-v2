---
name: pick-lifecycle
description: Guard actual pick-state transitions and settlement correction chains. Use when code reads or writes picks.status, pick_lifecycle, or settlement transitions; not for routing-only work.
category: implementation
owner: codex
trigger: Changing lifecycle-state transition code, pick_lifecycle persistence, or settlement/correction behavior.
---

# Pick Lifecycle

Use this before changing lifecycle or settlement behavior.
Routing or promotion work that does not change lifecycle transitions belongs to
`promotion-routing` or `runtime-delivery` instead.

## Allowed state machine

```text
validated -> queued | voided
queued    -> posted | voided
posted    -> settled | voided
settled   -> terminal
voided    -> terminal
```

Never skip states.

## Invariants

- `transitionPickLifecycle()` is the single transition path
- `settlement_records` are immutable; corrections insert new rows via `corrects_id`
- terminal states cannot transition further
- queuing must still honor promotion/distribution gates

## Required verification

```bash
pnpm type-check
pnpm test
```

Then verify actual state with:
```bash
pnpm verify:pick -- <pick-id>
```

## Reference

For the full shared team version, read:
- [`.claude/commands/pick-lifecycle.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/pick-lifecycle.md)
