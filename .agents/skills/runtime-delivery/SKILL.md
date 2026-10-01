---
name: runtime-delivery
description: Guard cross-boundary delivery behavior spanning API enqueue, worker processing, receipts, or runtime delivery health. Do not use for a worker-only edit.
category: implementation
owner: codex
trigger: A change crosses API-to-worker delivery boundaries or changes end-to-end delivery health semantics.
---

# Runtime Delivery

Use this only when a change crosses API enqueue, worker delivery, receipts, or
end-to-end delivery health. For `apps/worker/**`-only work, use `outbox-worker`.
For lifecycle transitions without delivery semantics, use `pick-lifecycle`.

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
