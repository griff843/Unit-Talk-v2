---
name: pick-lifecycle
description: Guard Unit Talk lifecycle transitions. Use before changing picks.status, pick_lifecycle, settlement records, distribution enqueue paths, or any code that transitions a pick across lifecycle states.
---

# Pick Lifecycle

Use this before changing lifecycle or settlement behavior.

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
