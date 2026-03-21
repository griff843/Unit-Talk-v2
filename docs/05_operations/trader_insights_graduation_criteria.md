# Trader-Insights Graduation Criteria

This document defines the operator state that must be confirmed true before `discord:trader-insights` is added to `UNIT_TALK_DISTRIBUTION_TARGETS` for live routing.

Modeled after `docs/05_operations/canary_graduation_criteria.md` (which governs canary → best-bets promotion).

Authority: `docs/05_operations/week_10_operator_command_center_contract.md`

---

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture / Program Owner |
| Status | Ratified |
| Ratified | 2026-03-20 |
| Last Updated | 2026-03-20 |

---

## Prerequisites (All Must Be Met Before Evaluation)

| Condition | Required State |
|---|---|
| `discord:canary` | Live and healthy — permanent control lane active |
| `discord:best-bets` | Live, stable, and healthy — minimum 7 days since last incident |
| `pnpm test` | Passing |
| `pnpm test:db` | Passing |
| Operator-web `bestBets` section | Live and showing accurate data |
| Operator-web picks pipeline | Live and showing accurate lifecycle state counts |
| `discord:trader-insights` activation contract | Written and ratified (separate from this document) |

---

## Promotion Eligibility Decision for `discord:trader-insights`

**Decision: Use a distinct eligibility profile from `discord:best-bets`.**

Rationale:
- `discord:best-bets` is a high-signal execution board. Eligibility is based on overall quality score (current threshold: 70.00).
- `discord:trader-insights` is a VIP+ market-alerts channel. Picks routed here should be high-confidence plays with strong edge and trust scores specifically.
- Routing the same qualified best-bets picks to trader-insights would dilute both channels.

**Provisional trader-insights eligibility thresholds (to be confirmed in the activation contract):**

| Score Component | Required Minimum | Notes |
|---|---|---|
| Overall promotion score | ≥ 80.00 | Higher bar than best-bets (70.00) |
| `edge` component | ≥ 85 | Must show strong edge signal |
| `trust` component | ≥ 85 | Must show high trust |
| Approval status | `approved` | Same as best-bets |
| Promotion target | `trader-insights` | Must be explicitly targeted |

These thresholds are provisional. The activation contract must confirm or revise them before implementation begins.

---

## Required Operator Evidence (Before Activation Decision)

The operator-web must show all of the following before a go/no-go decision is made:

| Evidence Field | Required Value |
|---|---|
| `discord:canary` recent sent count | ≥ 3 in current window |
| `discord:canary` recent failure count | 0 |
| `discord:canary` recent dead-letter count | 0 |
| `discord:best-bets` recent sent count | ≥ 1 in current window |
| `discord:best-bets` recent failure count | 0 |
| `discord:best-bets` recent dead-letter count | 0 |
| Worker health | `healthy` |
| Distribution health | `healthy` |
| Failed outbox rows (all targets) | 0 |
| Pending outbox rows | 0 |
| Picks pipeline `posted` count | ≥ 1 (active system state) |

---

## Activation Proof Requirements

The activation proof for `discord:trader-insights` must capture all of the following (analogous to the Week 7 Best Bets activation proof):

| Stage | Proof Field |
|---|---|
| Submission | submission ID |
| Pick creation | pick ID, approval status `approved` |
| Promotion | promotion history ID, status `qualified`, target `trader-insights`, score ≥ 80.00 |
| Routing | outbox ID, target `discord:trader-insights`, status `sent` |
| Receipt | receipt ID, channel ID `1356613995175481405`, dryRun `false` |
| Audit | audit entry `distribution.sent`, entity_id = outbox ID |
| Operator state | operator snapshot confirming correct channel, no failures |

A canary-safe preview (routing to `discord:canary` with the new payload format) must be sent and verified before the real-channel activation run.

---

## Rollback Trigger Conditions for `discord:trader-insights`

Remove `discord:trader-insights` from `UNIT_TALK_DISTRIBUTION_TARGETS` immediately if any of the following occur:

- Any `discord:trader-insights` outbox row enters `dead_letter` and cannot be recovered within 24 hours
- Worker health is `degraded` or `down` for more than 4 consecutive hours with no recovery path
- A non-trader-insights-qualified pick reaches `discord:trader-insights`
- A pick is delivered to the wrong channel or wrong audience tier
- More than 2 consecutive delivery failures after activation

When triggered:
- Remove only `discord:trader-insights` from `UNIT_TALK_DISTRIBUTION_TARGETS`
- Keep `discord:canary` and `discord:best-bets` active
- Do not delete outbox rows
- Record evidence in `docs/06_status/status_source_of_truth.md`

---

## Go / No-Go Decision Record

*Fill in after the activation contract is ratified and the operator evidence is confirmed.*

| Field | Value |
|---|---|
| Decision | pending |
| Decision date | ___ |
| Evidence snapshot timestamp | ___ |
| Operator confirmed all prerequisites | ___ |
| Recorded by | ___ |

---

## Authority Links

| Purpose | File |
|---|---|
| Week 10 contract | `docs/05_operations/week_10_operator_command_center_contract.md` |
| Canary graduation criteria (reference model) | `docs/05_operations/canary_graduation_criteria.md` |
| Discord routing policy | `docs/05_operations/discord_routing.md` |
| Best Bets channel contract | `docs/03_product/best_bets_channel_contract.md` |
| Program state | `docs/06_status/status_source_of_truth.md` |
