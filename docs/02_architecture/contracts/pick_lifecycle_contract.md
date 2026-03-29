# Pick Lifecycle Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-29 — depth pass UTV2-160 |

---

## Purpose

This contract defines the pick status state machine, who owns each transition, what evidence is required for each state change, and what must not happen outside the governed path.

---

## State Machine

```
validated
   │
   ▼
queued
   │
   ▼
posted
   │
   ▼
settled
```

From any state (except `settled`):
```
→ voided
```

| State | Meaning |
|---|---|
| `validated` | Pick accepted by submission service; canonical fields populated; domain analysis attached |
| `queued` | Pick claimed by worker; outbox row is `processing` |
| `posted` | Pick delivered to Discord; `distribution_receipts` row present |
| `settled` | Outcome recorded; `settlement_records` row present with final result |
| `voided` | Pick withdrawn; no further lifecycle transitions |

---

## Allowed Transitions

| From | To | Actor | Trigger |
|---|---|---|---|
| _(none)_ | `validated` | `apps/api` | `POST /api/submissions` success |
| `validated` | `queued` | `apps/worker` | Outbox row claimed; delivery starting |
| `queued` | `posted` | `apps/worker` | Discord delivery confirmed; receipt written |
| `posted` | `settled` | `apps/api` | `POST /api/picks/:id/settle` with final result |
| Any (not settled) | `voided` | `apps/api` | Operator void action |

**No other transitions are permitted.** Attempting to transition `validated → posted` (skipping `queued`) or `posted → validated` (backward transition) must fail.

---

## Enforcement Surface

Lifecycle transitions are enforced by `transitionPickLifecycle()` in `packages/db/src/lifecycle.ts`. This function:

1. Checks the current `picks.status` against the allowed-transitions table
2. Returns `{ success: false, reason }` for disallowed transitions — it does not throw
3. On success: writes a `pick_lifecycle` row and updates `picks.status`
4. Is imported by both `apps/api` and `apps/worker`; never bypassed

**No service may update `picks.status` except through `transitionPickLifecycle()`.** Direct SQL updates to `picks.status` outside this function are a contract violation.

---

## Evidence Requirements per Transition

### validated (entry)
- `submission_events` row with `event_name = 'submission.accepted'`
- `pick_promotion_history` row for each evaluated policy
- `audit_log` entry for `submission.validated`

### queued
- `distribution_outbox` row with `status = 'processing'`
- `pick_lifecycle` row with `to_state = 'queued'`

### posted
- `distribution_receipts` row with Discord channel ID
- `distribution_outbox` row with `status = 'sent'`
- `pick_lifecycle` row with `to_state = 'posted'`
- `audit_log` entry for `distribution.sent`

### settled
- `settlement_records` row with `status = 'settled'` and non-null `result`
- `pick_lifecycle` row with `to_state = 'settled'`
- `audit_log` entry for `settlement.recorded`

### voided
- `pick_lifecycle` row with `to_state = 'voided'`
- `audit_log` entry for `pick.voided` with reason

---

## Pick Lifecycle Table

Each transition writes a row to `pick_lifecycle`:

| Column | Value |
|---|---|
| `pick_id` | FK to `picks.id` |
| `from_state` | Prior status (nullable on initial `validated` entry) |
| `to_state` | New status |
| `created_at` | Transition timestamp |

The `pick_lifecycle` table is append-only. Rows are never updated or deleted. It is the audit trail of the lifecycle history for every pick.

---

## Denormalized Fields

`picks.status` is the current lifecycle state. It is the single queryable field for "where is this pick now."

`picks.posted_at` and `picks.settled_at` are denormalized caches set by the application at the time of transition. They are not maintained by DB trigger and must be set by the transition code. They exist for query performance — do not use them as lifecycle truth; use `pick_lifecycle` rows for audit.

---

## Manual Overrides

An operator may void a pick. Void transitions require:

- A reason provided by the operator
- The reason written to `audit_log`
- The transition performed through the governed path (not a direct SQL update)

**No manual override may transition a pick backward** (e.g., `settled → posted`). Corrections to settled picks use `settlement_records.corrects_id` (see `settlement_contract.md`).

---

## Failure Behavior

| Failure | Behavior |
|---|---|
| Invalid transition requested | `transitionPickLifecycle()` returns `{ success: false, reason }`; no DB write occurs |
| Pick not found | Returns `{ success: false, reason: 'pick not found' }` |
| DB write fails mid-transition | Pick status is not updated; lifecycle row not written; caller receives error; pick remains in prior state |
| Worker claims outbox but crashes before posting | Stale claim reaper resets outbox; pick remains `validated`; retry delivers to `queued → posted` |

---

## Invariants

- A pick in `settled` state cannot transition further.
- A pick in `voided` state cannot transition further.
- `picks.status` always reflects the latest `pick_lifecycle` row's `to_state`.
- A `distribution_receipts` row cannot exist for a pick that is not `posted` or `settled`.
- `settlement_records` rows cannot exist for a pick that has never been `posted`.

---

## Audit and Verification

To verify lifecycle correctness for a pick:

1. Query `pick_lifecycle WHERE pick_id = X ORDER BY created_at ASC` — transitions must be sequential and valid.
2. Confirm `picks.status` matches the latest `to_state`.
3. For `posted` picks: confirm `distribution_receipts` row exists.
4. For `settled` picks: confirm `settlement_records` row exists with `status = 'settled'`.
5. Confirm `audit_log` entries exist for each transition (keyed by `entity_ref = pick_id`).
