# Week 9 Full Lifecycle Proof Template

Use this template to capture the first complete end-to-end lifecycle proof: submission through settlement.

Copy the filled-in version into `docs/06_status/system_snapshot.md` under the heading
`Week 9 Full Lifecycle Proof`. Do not edit this template in place.

Authority: `docs/05_operations/week_9_full_lifecycle_contract.md`

---

## Pre-Run Checks

| Check | Result |
|---|---|
| `pnpm type-check` | pass / fail |
| `pnpm build` | pass / fail |
| `pnpm test` | pass / fail — count: ___ |
| `pnpm test:db` | pass / fail |
| Worker health (operator snapshot) | healthy / degraded / down |
| Failed outbox rows before run | count: ___ |
| `discord:canary` recent sent count | ___ |
| `discord:best-bets` failed/dead_letter rows | count: ___ |

---

## Stage 1 — Submission

| Field | Value |
|---|---|
| Submission ID | ___ |
| Submission event ID | ___ |
| Submission source | smart-form / api |
| Submission created at | ___ |

---

## Stage 2 — Pick Creation and Approval

| Field | Value |
|---|---|
| Pick ID | ___ |
| Approval status | `approved` |
| Pick created at | ___ |

---

## Stage 3 — Promotion

| Field | Value |
|---|---|
| Promotion history ID | ___ |
| Promotion status | `qualified` |
| Promotion target | `best-bets` |
| Promotion score | ___ |
| Promotion reason | ___ |
| Promotion decided at | ___ |

---

## Stage 4 — Routing and Delivery

| Field | Value |
|---|---|
| Outbox ID | ___ |
| Outbox target | `discord:best-bets` |
| Outbox status | `sent` |
| Posted lifecycle event ID | ___ |

---

## Stage 5 — Receipt

| Field | Value |
|---|---|
| Receipt ID | ___ |
| Discord message ID | ___ |
| Target channel ID | `1288613037539852329` |
| Receipt status | `sent` |
| dryRun | `false` |

---

## Stage 6 — Settlement

| Field | Value |
|---|---|
| Settlement record ID | ___ |
| Settlement result | win / loss / push / void / no_action |
| Settlement source | operator / api / feed |
| Settlement confidence | confirmed / estimated / pending |
| Settlement evidence reference | ___ |
| Correction link | ___ / none |
| `settled_by` actor | ___ |
| Settled lifecycle event ID | ___ |

---

## Stage 7 — Audit and Operator Truth

| Field | Value |
|---|---|
| Audit action IDs | `promotion.qualified`: ___ |
| | `distribution.sent`: ___ |
| | `settlement.recorded`: ___ |
| Operator snapshot timestamp | ___ |
| Final pick lifecycle state | `settled` |
| Worker health at snapshot | healthy / degraded / down |
| Settlement visible in operator-web | yes / no |

---

## Post-Run Operator Checks (complete within 15 minutes)

| Check | Result | Timestamp |
|---|---|---|
| Lifecycle chain complete (4 events) | yes / no | ___ |
| Settlement record in DB | yes / no | ___ |
| All 3 audit entries present | yes / no | ___ |
| Operator-web shows settled state | yes / no | ___ |
| Original outbox row unmodified | yes / no | ___ |
| Original receipt row unmodified | yes / no | ___ |
| `discord:canary` still posting | yes / no | ___ |
| `discord:best-bets` still healthy | yes / no | ___ |
| Failed/dead_letter outbox rows | count: ___ | ___ |

---

## Independent Verification

Verify all fields below via Supabase PostgREST REST API (service_role_key — not API response, not worker log).

```sql
-- 1. confirm submission
select id, source, created_at from submissions where id = '<submission_id>';

-- 2. confirm pick promotion state
select id, approval_status, promotion_status, promotion_target, promotion_score
from picks where id = '<pick_id>';

-- 3. confirm promotion history
select id, pick_id, target, status, decided_at, override_action
from pick_promotion_history where pick_id = '<pick_id>'
order by created_at desc limit 3;

-- 4. confirm outbox row
select id, status, target, pick_id, created_at, updated_at
from distribution_outbox where id = '<outbox_id>';

-- 5. confirm receipt
select id, outbox_id, receipt_type, status, external_id, channel, recorded_at
from distribution_receipts where id = '<receipt_id>';

-- 6. confirm complete lifecycle chain
select id, to_state, from_state, writer_role, created_at
from pick_lifecycle where pick_id = '<pick_id>'
order by created_at asc;

-- 7. confirm settlement record
select id, pick_id, result, source, confidence, settled_by, status,
       evidence_ref, corrects_id, settled_at
from settlement_records where pick_id = '<pick_id>';

-- 8. confirm audit entries (promotion.qualified)
select id, entity_type, entity_id, action, actor, entity_ref, created_at
from audit_log where entity_ref = '<pick_id>'
order by created_at asc;

-- 9. confirm audit entry (settlement.recorded — entity_id = settlement_record_id)
select id, entity_type, entity_id, action, actor, entity_ref, payload, created_at
from audit_log where entity_id = '<settlement_record_id>';

-- 10. confirm original outbox row unmodified after settlement
select id, status, updated_at from distribution_outbox where id = '<outbox_id>';

-- 11. confirm zero failed/dead_letter outbox rows
select id, status, target, created_at from distribution_outbox
where status in ('failed', 'dead_letter');
```

Record results: ___

---

## Verdict

| Field | Value |
|---|---|
| Full lifecycle run result | pass / fail |
| All 23 proof fields captured | yes / no |
| All 3 audit entries confirmed | yes / no |
| Distribution artifacts unmodified | yes / no |
| Failure note created | yes / no |
| Proof recorded in `system_snapshot.md` | yes / no |
| Anti-drift cleanup complete | yes / no |
| Readiness decision written | yes / no |
| Linear Week 9 issue updated | yes / no |
| Notion Week 9 checkpoint updated | yes / no |
