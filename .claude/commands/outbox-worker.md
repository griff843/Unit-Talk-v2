# /outbox-worker

Red-flag card for `apps/worker/` and `distribution_outbox` changes. Exactly one DeliveryOutcome per attempt. Worker contains no business logic.

---

## When this skill applies

Touching `apps/worker/`, `distribution_outbox`/`distribution_receipts`, `DeliveryAdapter`, `DeliveryOutcome`, circuit breakers, or `distribution-service.ts` (enqueue path).

---

## Core invariants (never violate)

1. **Exactly one `DeliveryOutcome` per attempt** (`sent | retryable-failure | terminal-failure`). No swallowed errors.
2. **One delivery path per outbox row.** Idempotency key enforces at DB; enforce in code too.
3. **Worker = mechanical.** Poll → claim atomically → call adapter → record outcome → release/dead-letter. No promotion eval, no re-scoring, no lifecycle writes.
4. **Receipt written before `sent`.** If receipt write fails → `retryable-failure`, not `sent`.
5. **Per-target circuit breaker.** Never global.
6. **Bounded retry.** After N retries → `terminal-failure` → `dead_letter`. No infinite loops.

---

## Outbox row lifecycle

```
pending → processing → sent
                    → retryable-failure → pending (retry) | dead_letter (≥ threshold)
                    → dead_letter (terminal-failure)
```

Rows stuck in `processing` past the heartbeat timeout must be released back to `pending` by stall detection.

---

## Red flags — stop if you see these

- `catch` block that logs and continues without setting a `DeliveryOutcome`
- Delivery call outside the adapter interface
- Two code paths calling the adapter for the same outbox row
- `promotionScore`, `evaluatePromotion`, or `transitionPick*` inside `apps/worker/`
- Receipt written after the outbox row is marked `sent`
- No dead-letter threshold (infinite retry)
- Shared circuit breaker state across targets

---

## Verification greps

```bash
# No business logic in worker
grep -r "promotionScore\|evaluatePromotion\|transitionPick" apps/worker/src/ --include="*.ts"

# Every catch produces an outcome (manual review of context)
grep -rn "catch" apps/worker/src/ --include="*.ts" -A3
```

First must return zero. Second: review each catch block for a typed outcome.
