---
name: outbox-worker
description: Guard worker-owned delivery execution. Use for apps/worker, claim/attempt handling, adapters, retries, receipts, or circuit breakers; use runtime-delivery for cross-boundary flows.
category: implementation
owner: codex
trigger: Touching apps/worker or worker-owned claim, attempt, adapter, retry, receipt, or circuit-breaker behavior.
---

# Outbox Worker

Use this before changing worker, outbox, receipt, or delivery-adapter behavior.
Use `runtime-delivery` as well only when the change crosses the API/worker
boundary or changes end-to-end delivery-health semantics.

## Invariants

- exactly one `DeliveryOutcome` per delivery attempt
- no swallowed errors
- one delivery path per outbox row
- circuit breaker is per target, never global
- worker contains no business logic

## Worker owns

- claim row
- call adapter
- persist outcome and receipt
- requeue or dead-letter

## Worker does not own

- promotion evaluation
- rerouting decisions
- scoring
- direct business-policy changes

## Required verification

```bash
pnpm type-check
pnpm test
```

Quick audits:
```bash
rg "catch" apps/worker/src
rg "promotionScore|evaluatePromotion|transitionPick" apps/worker/src
```

Review every `catch` path for a concrete typed outcome.

## Reference

For the full shared team version, read:
- [`.claude/commands/outbox-worker.md`](C:/Dev/Unit-Talk-v2-main/.claude/commands/outbox-worker.md)
