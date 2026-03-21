# Week 8 Settlement Runtime Contract

This file is the binding execution contract for Week 8 settlement runtime work.

Authority:
- `docs/02_architecture/contracts/settlement_contract.md`
- `docs/05_operations/settlement_planning.md`
- `docs/05_operations/week_8_settlement_readiness_review.md`

## Metadata

| Field | Value |
|---|---|
| Owner | Runtime |
| Status | Active |
| Ratified | 2026-03-20 |
| Last Updated | 2026-03-20 |

## Objective

Implement the first canonical settlement runtime for V2 so that a posted pick can be:
- rejected when the settlement request is invalid
- routed to manual review when the outcome is ambiguous
- settled through additive settlement records
- corrected later through additional additive settlement records
- observed through the read-only operator surface

Week 8 is complete only when one posted pick can be settled through the canonical API path, the operator surface can read the settlement evidence, and the proof fields defined below can be captured without mutating historical records.

## Required Delivery Order

Implement only in this order:

1. Settlement schema alignment migration
2. Settlement write path
3. Correction path as additive records
4. Manual review path for ambiguous cases
5. Operator read path for settlement visibility
6. Tests
7. First posted-to-settled proof capture support

## Binding Runtime Rules

### 1. Invalid Request Rejection

Reject the request without writing any settlement record when:
- the pick does not exist
- the requested action shape is invalid
- a `settled` request does not include a valid settlement result
- a `manual_review` request does not include a review reason
- the pick is not in a lifecycle state that allows the requested action

### 2. Manual Review for Ambiguous Settlement

Manual review is a durable, additive record for ambiguous cases.

Rules:
- it writes a `settlement_records` row with `status = manual_review`
- it does not transition the pick lifecycle to `settled`
- it leaves the pick in `posted`
- it requires a review reason and evidence reference
- it emits an audit trail

### 3. Additive Correction for Already-Settled Picks

Corrections must never mutate prior settlement records.

Rules:
- a correction writes a new `settlement_records` row
- the correction row links to the prior row through `corrects_id`
- the pick remains in `settled`
- it emits an audit trail
- history must clearly show the original settlement and the correction

## Week 8 Deliverables

### Schema

- align `settlement_records` to the Week 8 contract
- support settled outcomes and manual-review records in the same table
- support additive correction links
- regenerate DB types after migration

### Write Path

- `POST /api/picks/:id/settle`
- canonical service owned by `apps/api`
- deterministic lifecycle behavior:
  - `posted + settled request -> settled`
  - `posted + manual_review request -> remains posted`
  - `settled + settled request -> additive correction, remains settled`

### Read Path

- operator snapshot returns recent settlement rows
- operator dashboard renders recent settlements separately from outbox/receipts
- operator surface stays read-only

### Tests

At minimum:
- invalid request rejection
- posted pick settles successfully
- ambiguous case creates manual-review record and leaves pick posted
- already-settled pick creates additive correction record
- audit trail exists for settle/manual-review/correction
- operator snapshot exposes settlement rows
- live DB smoke covers one posted-to-settled path

## Freeze Rules

Do not do any of the following in Week 8:
- change Discord routing
- change promotion-gate behavior
- introduce new channels
- start intelligence expansion
- add non-settlement UI polish
- create a second settlement write path outside `apps/api`

## Acceptance Criteria

Week 8 is complete only when all of the following are true:

1. the schema migration is applied and generated types match it
2. the canonical API settlement route is live
3. invalid requests are rejected without writes
4. ambiguous cases create manual-review records without settling the pick
5. already-settled picks create additive correction records instead of mutating prior records
6. operator-web can read and render settlement evidence
7. automated tests for the settlement slice pass
8. `pnpm test:db` proves one posted-to-settled path against the live database

## First Posted-to-Settled Proof Fields

The first Week 8 proof bundle must capture:
- submission ID
- pick ID
- posted lifecycle event ID
- settlement record ID
- settlement status/result
- settlement source
- settlement evidence reference
- correction link if any
- settled lifecycle event ID
- audit action IDs
- operator snapshot timestamp
- final pick lifecycle state

## Non-Goals

- automated settlement feeds
- multi-leg or parlay settlement
- new Discord surfaces
- intelligence/ranking expansion
- recap/reporting work outside settlement proof
- broad operator-web redesign

