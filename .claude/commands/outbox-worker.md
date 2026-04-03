# /outbox-worker

Enforce correct outbox and delivery patterns before and during any change to outbox polling, delivery adapters, retry logic, circuit breakers, or DeliveryOutcome handling.

Exactly one DeliveryOutcome per attempt. No swallowed errors. No duplicate delivery paths. Worker contains no business logic.

---

## When this skill applies

Apply automatically when touching any of:
- `apps/worker/` (any file)
- `distribution_outbox` table reads or writes
- `distribution_receipts` table reads or writes
- `DeliveryAdapter` interface or implementations
- `DeliveryOutcome` type (`sent | retryable-failure | terminal-failure`)
- Circuit breaker logic
- Outbox claim / release patterns
- `distribution-service.ts` (enqueue path)

---

## Core invariants — never violate

**1. Exactly one DeliveryOutcome per attempt**
Every delivery attempt must produce exactly one typed outcome:
- `sent` — delivery confirmed
- `retryable-failure` — transient error, worker will retry
- `terminal-failure` — permanent failure, move to dead_letter

Never leave an attempt without an outcome. Never swallow exceptions silently.

**2. No duplicate delivery paths**
There is exactly one code path from outbox row → delivery adapter → receipt. No parallel delivery attempts for the same row. The idempotency key on the outbox row enforces this at the DB level — enforce it in code too.

**3. Worker contains no business logic**
The worker's job:
- Poll `distribution_outbox` for unclaimed rows
- Claim a row (set `claimed_at`, `claimed_by`)
- Call the delivery adapter
- Record the outcome
- Release or dead-letter the row

It does NOT:
- Evaluate promotion eligibility
- Re-score picks
- Make routing decisions
- Modify pick lifecycle state directly (only records receipts; lifecycle transitions happen in the API)

**4. No swallowed errors**
Every exception must produce either a `retryable-failure` or `terminal-failure` outcome. `try/catch` blocks that log and continue without setting an outcome are bugs.

**5. Circuit breaker per target**
Each delivery target (`discord:best-bets`, `discord:trader-insights`, etc.) has its own circuit breaker. A failure on one target must not affect delivery to another.

---

## Pre-implementation checklist

**[ ] DeliveryOutcome is typed and exhaustive**
The outcome type must be a discriminated union. No string literals inline. No `any`.

**[ ] Claim is atomic**
The claim operation must use a DB-level lock or conditional update (e.g. `WHERE claimed_at IS NULL`). Never claim in application memory then write separately.

**[ ] Idempotency key is enforced**
`distribution_outbox.idempotency_key` must be set at enqueue time. The delivery adapter must not re-deliver if a receipt already exists for that key.

**[ ] Receipt is written before outcome is returned**
`distribution_receipts` row must be written before the worker marks the outbox row `sent`. If the receipt write fails, the outcome is `retryable-failure`, not `sent`.

**[ ] Dead-letter threshold is respected**
After N retries (configured per target), a `retryable-failure` becomes `terminal-failure` and the row moves to `dead_letter` status. This must be enforced — no infinite retry loops.

---

## Verification after worker changes

```bash
pnpm type-check
pnpm test
```

Also confirm:
- No business logic imported into worker from domain — only adapter calls
- Circuit breaker state is per-target, not global
- Retry count is bounded and configurable
- Dead-letter rows are written, not silently dropped

Check for swallowed errors:
```bash
grep -r "catch" apps/worker/src/ --include="*.ts" -A3
```

Review each catch block: does it set a `DeliveryOutcome`? If not, flag it.

Check for business logic in worker:
```bash
grep -r "promotionScore\|evaluatePromotion\|transitionPick" apps/worker/src/ --include="*.ts"
```

Each of these must return zero results.

---

## Outbox row lifecycle

```
pending
  → processing (worker claims row)
    → sent (delivery confirmed, receipt written)
    → retryable-failure (retry count < threshold)
      → pending (re-queued for retry)
      → dead_letter (retry count ≥ threshold → terminal-failure)
    → dead_letter (terminal-failure)
```

Any row stuck in `processing` beyond the heartbeat timeout must be released back to `pending` by the worker's stall detection logic.

---

## Delivery stall detection

Worker must detect rows stuck in `processing` with `claimed_at` older than the stall threshold. These are:
- Workers that crashed mid-delivery
- Claims that were never released

Stall recovery: release claim, reset to `pending`, increment retry count.

---

## Red flags — stop if you see these

- A catch block that logs and continues without setting a `DeliveryOutcome`
- A delivery call that happens outside the adapter interface
- Two code paths that both call the adapter for the same outbox row
- Business logic (scoring, promotion evaluation) inside `apps/worker/`
- A receipt written after the outbox row is marked `sent`
- No dead-letter threshold — retries can run forever
- Circuit breaker state shared across targets

Report the violation before writing any fix.

---

## Output format (when invoked explicitly)

```
## Outbox Worker Check

### Scope
Files in scope: [list]
Invariant most at risk: [name it]

### DeliveryOutcome audit
- All catch blocks produce a typed outcome: YES / NO (file:line)
- No swallowed errors: YES / VIOLATION (file:line)
- Outcome type is exhaustive discriminated union: YES / NO

### Delivery path audit
- Single delivery path per outbox row: YES / DUPLICATE PATH (describe)
- Idempotency key enforced: YES / NO
- Receipt written before sent status: YES / NO

### Claim audit
- Claim is atomic (DB-level): YES / NO
- Stall detection implemented: YES / NO
- Dead-letter threshold configured: YES / NO (current value: N)

### Business logic audit
- promotionScore / evaluatePromotion in worker: CLEAN / VIOLATION (file:line)
- Lifecycle transitions in worker: CLEAN / VIOLATION (file:line)

### Circuit breaker audit
- Per-target circuit breaker: YES / GLOBAL (violation)

### Verdict
CLEAN — proceed
— or —
VIOLATIONS FOUND — fix before implementation:
  - [list each violation]
```
