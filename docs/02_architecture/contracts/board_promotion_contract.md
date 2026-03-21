# Board Promotion Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture / Product |
| Status | Ratified |
| Ratified | 2026-03-20 |
| Last Updated | 2026-03-20 |

## Purpose

Board promotion is the second gate after approval.

Gate 1 answers:
- is the pick valid, canonical, and publishable?

Gate 2 answers:
- does the pick earn promotion into a high-signal execution board?

Approval does not imply promotion.

## Initial Target

V1 promotion is implemented for:
- `best-bets`

The design must remain extensible so future boards can reuse the same evaluator layer:
- `trader-insights`
- `strategy-lab`
- curated digests
- future premium boards

## Product Role

For `best-bets`, the promotion layer exists to protect the board identity:
- quality over quantity
- signal over volume
- execution over commentary

The promotion layer must stop the board from degrading into a copy of the general approved feed.

## Inputs

The evaluator takes:
- canonical pick record
- approval status
- freshness and posting-window state
- market validity state
- board state
- redundancy/exposure state
- operator overrides
- scoring inputs for edge, trust, actionability, distinctiveness, and board fit

## Hard Eligibility Rules

A pick cannot enter `best-bets` unless all of these are true:
- approval status is `approved`
- required canonical fields are present
- pick is not voided, errored, stale, or expired
- pick is still within posting window
- odds or market data are still actionable enough to use
- pick is not blocked by operator override or risk rule
- pick is not a duplicate or near-duplicate already promoted

If any rule fails, the pick is not promotion-eligible.

## Promotion Score

After hard eligibility passes, the evaluator computes a weighted promotion score.

V1 score buckets:
- Edge / EV: 35%
- Confidence / trust: 25%
- Market readiness / timing: 20%
- Uniqueness / redundancy control: 10%
- Board fit / presentation quality: 10%

The evaluator must remain deterministic for the same inputs and scoring version.

## Board Rules

V1 board protection rules:
- board cap per slate
- cap per sport
- cap per game or thesis cluster
- redundancy suppression for highly correlated or repeated plays
- confidence floor separate from baseline approval
- time-window protection for stale or late picks

## Overrides

Operator authority must support:
- `force_promote`
- `suppress_from_best_bets`
- reason logging

Overrides must be durable and auditable.

## Outputs

The evaluator returns:
- promotion status
- promotion target if qualified
- promotion score
- score breakdown
- explanation payload
- suppression reasons when not promoted
- evaluator version
- decision actor and timestamp

## Promotion Statuses

V1 statuses:
- `not_eligible`
- `eligible`
- `qualified`
- `promoted`
- `suppressed`
- `expired`

## Suggested Persistence Fields

Promotion should not be treated as a channel-routing boolean.

Minimum V1 fields:
- `approval_status`
- `promotion_status`
- `promotion_target`
- `promotion_score`
- `promotion_reason`
- `promotion_version`
- `promotion_decided_at`
- `promotion_decided_by`

## Guarantees

The promotion layer guarantees:
- approval does not imply promotion
- promotion decisions are deterministic for the same inputs and version
- decisions are auditable
- board caps and redundancy rules are enforceable
- operator overrides are logged

## Decision Flow

approved pick
-> eligibility check
-> promotion scoring
-> board-fit and redundancy review
-> qualified or suppressed
-> if qualified, route to board target

## V1 Scope

V1 should stay intentionally simple:
- start with one board target: `best-bets`
- use hard filters plus weighted scoring
- keep the rules explainable
- avoid pretending the evaluator is perfect

The right first milestone is not "perfect ranking."
It is "cleanly separating approval from promotion."
