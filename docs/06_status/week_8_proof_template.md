# Week 8 Proof Template — First Posted-to-Settled Run

Use this template after the first end-to-end settlement proof is complete.

Copy the filled-in version into `docs/06_status/system_snapshot.md` under the heading
`Week 8 Settlement - First Proof Bundle`. Do not edit this template in place.

Authority: `docs/05_operations/settlement_planning.md` — First Posted-to-Settled Proof section

---

## Pre-Settlement Checks (fill in before calling the settle route)

| Check | Result |
|---|---|
| `pnpm type-check` | pass / fail |
| `pnpm build` | pass / fail |
| `pnpm test` | pass / fail — count: ___ |
| `pnpm test:db` | pass / fail |
| Pick lifecycle state before settle | `posted` (required) |
| Pick outbox row status | `sent` (required) |
| Pick receipt present | yes / no |
| Pick Discord message ID recorded | ___ |

---

## Pick Being Settled

| Field | Value |
|---|---|
| Submission ID | ___ |
| Pick ID | ___ |
| Posted lifecycle event ID | ___ |
| Pick lifecycle state before settle | `posted` |
| Outbox ID | ___ |
| Receipt ID | ___ |
| Discord message ID | ___ |
| Original Discord channel | `discord:canary` (required — see settlement_planning.md constraint) |

---

## Settlement Evidence

| Field | Value |
|---|---|
| Settlement record ID | ___ |
| Settlement status / result | win / loss / push / void / no_action |
| Settlement source | operator / api / feed |
| Settlement evidence reference | ___ (note, URL, or source identifier) |
| Correction link (if this corrects a prior record) | ___ / none |
| `settled_by` actor | ___ |
| `settled_at` timestamp | ___ |

---

## Lifecycle Transition Evidence

| Field | Value |
|---|---|
| Settled lifecycle event ID | ___ |
| Final pick lifecycle state | `settled` |
| Lifecycle transition recorded at | ___ |

---

## Audit and Operator Evidence

| Field | Value |
|---|---|
| Audit action IDs | ___ (settlement event) |
| Operator snapshot timestamp | ___ |
| Pick visible in operator-web as `settled` | yes / no |
| Settlement record visible in operator-web | yes / no |
| Original receipt and Discord message ID unchanged | yes / no |

---

## Post-Settlement Operator Checks (fill in within 5 minutes)

| Check | Result | Timestamp |
|---|---|---|
| Settlement record exists in DB | yes / no | ___ |
| Pick lifecycle state | `settled` | ___ |
| Audit log entry present | yes / no | ___ |
| Operator snapshot shows settlement | yes / no | ___ |
| Original outbox/receipt rows unmodified | yes / no | ___ |
| `discord:canary` still posting | yes / no | ___ |
| `discord:best-bets` still healthy | yes / no | ___ |

---

## Verdict

| Field | Value |
|---|---|
| Settlement result | pass / fail |
| Failure note created | yes / no |
| Proof recorded in `system_snapshot.md` | yes / no |
| Linear Week 8 issue updated | yes / no |
| Notion Week 8 checkpoint updated | yes / no |

---

## Independent Verification Queries

Run these after settlement to verify independently from the API response:

```sql
-- confirm settlement record
select id, pick_id, outcome, result_source, confidence, settled_by, settled_at, is_correction
from settlement_records
order by settled_at desc limit 5;

-- confirm pick lifecycle transition to settled
select id, pick_id, to_state, from_state, created_at
from pick_lifecycle
where pick_id = '<pick_id>'
order by created_at desc limit 5;

-- confirm audit log entry
select id, entity_id, action, actor, created_at
from audit_log
where entity_id = '<pick_id>'
order by created_at desc limit 5;

-- confirm original outbox row is unmodified
select id, status, target, pick_id, updated_at
from distribution_outbox
where pick_id = '<pick_id>';

-- confirm original receipt is unmodified
select id, outbox_id, receipt_type, status, external_id, channel
from distribution_receipts
where outbox_id = '<outbox_id>';
```

Record results: ___
