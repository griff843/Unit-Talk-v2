# Week 7 Proof Bundle Template

Fill in every field below after the first real `discord:best-bets` post lands in channel `1288613037539852329`.

This template must be copied (not edited in place) into `docs/06_status/system_snapshot.md` as the canonical proof record.

Authority: `docs/05_operations/week_7_best_bets_activation.md`

---

## Pre-Activation Checks (fill in before sending)

| Check | Result |
|---|---|
| `pnpm type-check` | pass / fail |
| `pnpm build` | pass / fail |
| `pnpm test` (55 expected) | pass / fail — count: ___ |
| `pnpm test:db` | pass / fail |
| Live operator `canary.graduationReady` | true / false |
| Failed outbox rows before activation | count: ___ |
| `discord:best-bets` target in map | `1288613037539852329` (real channel) |
| `UNIT_TALK_DISTRIBUTION_TARGETS` includes `discord:best-bets` | yes / no |

---

## Pick Qualification Evidence (fill in before sending)

| Field | Value |
|---|---|
| pick `promotion_status` | qualified / promoted |
| pick `promotion_target` | best-bets |
| promotion score | ___ |
| promotion version | ___ |
| promotion decided by | ___ |
| qualification gate passed | yes / no |

Operating test result: "Does this pick belong on the high-signal execution board, or is it merely approved?"
Answer: ___

---

## Post-Activation Proof Bundle

| Field | Value |
|---|---|
| submission ID | ___ |
| pick ID | ___ |
| pick `promotion_status` | ___ |
| pick `promotion_target` | ___ |
| promotion history ID | ___ |
| outbox ID | ___ |
| outbox status | ___ |
| receipt ID | ___ |
| Discord message ID | ___ |
| target channel ID | `1288613037539852329` |
| run ID | ___ |
| audit action IDs | ___ |
| operator snapshot timestamp | ___ |
| worker health | ___ |
| canary health | ___ |

---

## Post-Activation Operator Checks (fill in within 15 minutes)

| Check | Result | Timestamp |
|---|---|---|
| `discord:best-bets` outbox row status | sent / failed / dead_letter | ___ |
| receipt present | yes / no | ___ |
| audit log entry present | yes / no | ___ |
| `discord:canary` still posting | yes / no | ___ |
| worker health | healthy / degraded / down | ___ |
| pending outbox count | ___ | ___ |
| failed outbox count | ___ | ___ |

---

## Verdict

| Field | Value |
|---|---|
| Activation result | pass / fail / rollback triggered |
| Rollback executed | yes / no |
| Proof recorded in system_snapshot.md | yes / no |
| Linear UNI-132 updated | yes / no |
| Notion Week 7 checkpoint updated | yes / no |

---

## Independent Verification Notes

Verify independently from the operator snapshot API. Do not rely only on the worker log.

Queries to run after activation:

```sql
-- confirm outbox row
select id, status, target, created_at from distribution_outbox
where target = 'discord:best-bets'
order by created_at desc limit 5;

-- confirm receipt
select id, outbox_id, receipt_type, status, external_id from distribution_receipts
order by created_at desc limit 5;

-- confirm pick promotion state
select id, promotion_status, promotion_target, promotion_score, promotion_decided_at
from picks
order by updated_at desc limit 5;

-- confirm promotion history
select id, pick_id, target, status, decided_at, override_action
from pick_promotion_history
order by created_at desc limit 5;

-- confirm canary is still sending
select id, status, target, created_at from distribution_outbox
where target = 'discord:canary'
order by created_at desc limit 3;
```

Record results: ___
