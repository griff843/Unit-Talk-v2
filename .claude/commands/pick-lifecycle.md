# /pick-lifecycle

Enforce pick lifecycle state machine rules before writing any lifecycle transition, status update, or settlement mutation.

`verify-pick` checks what happened. This skill checks what you are about to do.

---

## When this skill applies

Apply automatically before any code that:
- Calls `transitionPickLifecycle()` or any equivalent
- Writes to `picks.status`
- Writes to `pick_lifecycle` table
- Updates `picks.posted_at` or `picks.settled_at`
- Touches `settlement_records` table
- Calls `distribution-service.ts` enqueue path
- Involves lifecycle state in any conditional branch

---

## The allowed state machine

```
validated → queued    (pick promoted and enqueued for delivery)
validated → voided    (pick cancelled before delivery)
queued    → posted    (delivery confirmed, receipt written)
queued    → voided    (pick cancelled after enqueue, before delivery)
posted    → settled   (settlement recorded)
posted    → voided    (pick cancelled after posting — rare, requires audit)
settled   → (terminal — no further transitions)
voided    → (terminal — no further transitions)
```

`draft` exists in the transition map but is unused. All V2 picks start at `validated`.

**Never skip states.** `validated → posted` is not allowed. `validated → settled` is not allowed. Every transition must follow the chain.

---

## Pre-implementation checklist

**[ ] Identify the current state of the pick**
Read `picks.status` from the DB before writing a transition. Do not assume the current state.

**[ ] Verify the transition is allowed**
Check the state machine above. If the transition is not listed, it is not allowed.

**[ ] Check for terminal states**
If `picks.status` is `settled` or `voided`, no further transitions are possible. Return an error, do not silently succeed.

**[ ] Confirm the actor and reason are available**
`pick_lifecycle` rows must record `actor` (who triggered the transition) and optionally a reason. Do not write lifecycle rows without an actor.

**[ ] Settlement records are immutable**
`settlement_records` rows are never updated. Corrections are made by inserting a new row with `corrects_id` pointing to the original row. The original row is never mutated. If you are about to `UPDATE settlement_records`, stop.

**[ ] Audit log is required for T1 transitions**
Any transition involving a live routing target (`discord:best-bets`, `discord:trader-insights`) requires a corresponding `audit_log` entry. Confirm the service layer writes it.

---

## Implementation rules

**`transitionPickLifecycle()` is the single entry point**
All lifecycle transitions must go through `@unit-talk/db`'s `transitionPickLifecycle()` function. Do not write directly to `picks.status` or `pick_lifecycle` from app code without going through this function.

**Denormalized fields are secondary**
`picks.posted_at` and `picks.settled_at` are application-maintained caches. They must be updated when the corresponding lifecycle transition occurs, but they are not the source of truth. `picks.status` and `pick_lifecycle` are the source of truth.

**Distribution gate must be enforced before `queued`**
Only picks with `promotion_status = qualified` and a valid `promotion_target` may be enqueued. The distribution-service enforces this gate. Do not bypass it.

**Settlement source must be validated**
`settlement_records.source` must be `manual` or an approved source. `feed` settlement is blocked at the service layer and must never reach the DB. If you see `source = feed` in a settlement record, flag it as an anomaly.

---

## State-specific rules

### validated
- Entry state for all picks
- Promotion evaluation happens here
- Pick may be suppressed (stays `validated`, never queued) or qualified (moves to `queued`)

### queued
- Outbox row exists in `distribution_outbox` (status: `pending`)
- Pick must not be delivered twice — idempotency key enforces this

### posted
- Delivery confirmed — `distribution_receipts` row exists with `message_id`
- `picks.posted_at` is set
- Pick is now visible in the Discord channel

### settled
- `settlement_records` row exists
- `picks.settled_at` is set
- Terminal — no further transitions
- Original settlement record is never mutated; corrections use `corrects_id`

### voided
- Terminal — no further transitions
- May occur from any non-terminal state
- Requires audit log entry with reason

---

## Verification after lifecycle changes

```bash
pnpm type-check
pnpm test
```

Then verify the actual DB state using `/verify-pick` or `/db-verify` — do not trust the code alone.

Check for direct status writes:
```bash
grep -r "picks.status\s*=" apps/api/src/ --include="*.ts"
grep -r "UPDATE picks SET status" apps/api/src/ --include="*.ts"
```

Each direct write should go through `transitionPickLifecycle()`. Flag any that do not.

---

## Red flags — stop if you see these

- A transition that skips a state (e.g. `validated → posted`)
- An `UPDATE settlement_records` statement
- A lifecycle transition that does not write a `pick_lifecycle` row
- A `posted` pick with no `distribution_receipts` row
- `picks.status` written directly without going through `transitionPickLifecycle()`
- A transition from a terminal state (`settled` or `voided`)
- A pick with `promotion_status != qualified` that has an outbox row

Report the violation before writing any fix.

---

## Output format (when invoked explicitly)

```
## Pick Lifecycle Check

### Scope
Files in scope: [list]
Transition being written: <from_state> → <to_state>
Pick ID (if known): <uuid or N/A>

### Pre-transition check
- Current picks.status confirmed: YES / NOT CHECKED (assumed: <state>)
- Transition is in allowed state machine: YES / NO (violation: <describe>)
- Pick is not in terminal state: YES / NO (terminal — cannot proceed)
- actor available: YES / NO

### Settlement immutability check (if settlement in scope)
- New row inserted (not UPDATE): YES / NO (violation: UPDATE detected)
- corrects_id set if correction: YES / NO / N/A

### Audit log check
- audit_log entry written for this transition: YES / NO / NOT REQUIRED

### Distribution gate check (if queuing)
- promotion_status = qualified: YES / NO (gate violation)
- promotion_target is set: YES / NO

### Verdict
CLEAR — transition is valid, proceed
— or —
BLOCKED — fix before writing:
  - [list each issue]
```
