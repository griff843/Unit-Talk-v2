# Settlement Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-02-15 |
| Last Updated | 2026-03-21 — settlement semantics section added |

See `docs/05_operations/settlement_planning.md` for the locked implementation plan, target week, and first proof definition.
See `docs/05_operations/week_8_settlement_runtime_contract.md` for the binding Week 8 execution contract.

## Core Rules

- Settlement writes produce dedicated settlement records.
- Historical lifecycle and receipt data remain intact.
- Corrections require operator authority and explicit audit evidence.
- Settlement sources and confidence must be attributable.
- Invalid settlement requests are rejected without writes.
- Ambiguous cases are recorded as additive `manual_review` settlement records and do not settle the pick.
- Corrections for already-settled picks are additive records linked through `corrects_id`.

---

## Settlement Semantics

### What "settled" means

A pick is settled only when all of the following are true:

1. A final result (`win` / `loss` / `push` / `void` / `no_action`) has been recorded with explicit confidence and evidence reference.
2. An immutable `settlement_records` row exists with `status = 'settled'` and a non-null `result`.
3. The pick's `pick_lifecycle` has transitioned to `settled`.
4. An `audit_log` entry exists with `action = 'settlement.recorded'`, linking the settlement record and actor.

A `manual_review` record alone does not make a pick settled. A pick with only a `manual_review` record remains in `posted`.

### Required effects when a pick is settled

When the settlement path records a final result, the system must:

- Write an additive `settlement_records` row (`status = 'settled'`, `result` set, `corrects_id` null for initial settlement).
- Transition `pick_lifecycle` from `posted` to `settled` (via the existing lifecycle enforcement path).
- Write an `audit_log` entry recording the actor, the settlement record ID, and the result.
- Reflect the updated pick state (`status = 'settled'`) in the operator snapshot and operator-web.

### Must-not-mutate areas

Settlement must never write to or modify:

- `distribution_outbox` — outbox rows are immutable after `sent`
- `distribution_receipts` — receipt records are never overwritten
- `pick_promotion_history` — promotion decisions are not reconsidered at settlement time
- `submission_events` — intake events are append-only
- Prior `settlement_records` rows — corrections are always additive; the original row is never mutated

Corrections link to the prior record via `corrects_id` and leave all prior rows unchanged.

### Future-dependent consumers

Settlement records are the canonical source of outcome truth for downstream systems that do not yet exist in this repo. Future systems that depend on settlement data include:

- Recap generation
- ROI and performance summaries
- Analytics and reporting pipelines
- Automated settlement feed consumers

These are not implemented. Settlement records must be written correctly now so these systems can consume them without migration. Do not model settlement records around present consumers only.

### What settlement does not automatically trigger yet

Settlement does not automatically trigger any of the following unless they are explicitly implemented and wired:

- Recap generation or recap queue writes
- Analytics recomputation or event emission
- Subscriber-facing notifications or push events
- Broader settlement automation (feed-triggered writes, bulk resolution)

If a future week adds any of these, a separate contract must be written and ratified before implementation begins.
