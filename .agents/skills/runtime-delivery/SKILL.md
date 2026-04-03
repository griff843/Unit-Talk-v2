---
name: runtime-delivery
description: Guard Unit Talk runtime delivery behavior across API enqueue, worker processing, delivery adapters, and runtime health semantics. Use when changing delivery flow or runtime observability.
---

# Runtime Delivery

Use this when a change crosses API enqueue, worker delivery, adapter behavior, or runtime health.

## Focus areas

- enqueue gate correctness
- receipt/outbox consistency
- target-specific adapter semantics
- worker heartbeat and stall recovery
- runtime health reporting that matches actual system behavior

## Verification

```bash
pnpm exec tsx --test apps/api/src/server.test.ts apps/worker/src/worker-runtime.test.ts apps/ingestor/src/ingestor.test.ts
```

Use a smaller subset if the change is narrower.

## Reference

- [`.agents/skills/outbox-worker/SKILL.md`](C:/Dev/Unit-Talk-v2-main/.agents/skills/outbox-worker/SKILL.md)
- [`.agents/skills/db-verify/SKILL.md`](C:/Dev/Unit-Talk-v2-main/.agents/skills/db-verify/SKILL.md)
