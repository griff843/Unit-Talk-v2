---
name: outbox-worker
description: Guard Unit Talk outbox and worker changes. Use when touching apps/worker, distribution_outbox, distribution_receipts, delivery adapters, retry logic, or circuit breakers.
---

# Outbox Worker

Use this before changing worker, outbox, receipt, or delivery-adapter behavior.

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
