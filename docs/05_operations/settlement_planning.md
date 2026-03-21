# Settlement Planning Lock

This document locks the settlement implementation plan for V2.

Execution authority for Week 8 runtime work now lives in:
`docs/05_operations/week_8_settlement_runtime_contract.md`

It exists to prevent settlement from remaining undefined as a planning gap past Week 6.
Settlement runtime implementation does not begin in Week 6, but the plan must not remain unwritten.

Authority:
- `docs/02_architecture/contracts/settlement_contract.md`
- `docs/05_operations/week_8_settlement_runtime_contract.md`

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-03-20 |
| Last Updated | 2026-03-20 |

---

## Target Week

**Settlement implementation target: Week 8**

| Week | Focus |
|---|---|
| Week 6 | Runtime promotion gate, CI hardening (current) |
| Week 7 | Best-Bets live activation, post-activation monitoring, overflow hardening |
| Week 8 | Settlement implementation (this plan) |

Settlement runtime implementation must not begin before the Week 6 promotion gate and CI hardening are complete.

## Scope Constraint

V1 settlement is operator-initiated or API-triggered.
It records the outcome of a pick that has already been posted.

Settlement does not require in Week 8:
- automated settlement via an external data feed
- multi-outcome resolution (parlay, same-game parlay)
- a full ranking or intelligence layer
- any new product surface beyond the operator write path and operator-web visibility

Settlement does require in Week 8:
- a durable `settlement_records` table
- a write path (API route) to record an outcome
- a lifecycle transition from `posted` to `settled`
- operator-web visibility of settled picks
- the first end-to-end posted-to-settled proof

## First Three Slices

### Slice 1 — Settlement Schema

Deliverables:
- `settlement_records` table migration with fields:
  - `id` (uuid, pk)
  - `pick_id` (uuid, fk → picks.id)
  - `outcome` (text: `win` | `loss` | `push` | `void` | `no_action`)
  - `result_source` (text: `operator` | `api` | `feed`)
  - `confidence` (text: `confirmed` | `estimated` | `pending`)
  - `notes` (text, nullable)
  - `settled_by` (text — actor identifier)
  - `settled_at` (timestamptz)
  - `is_correction` (bool, default false)
  - `correction_reason` (text, nullable)
  - `correction_of` (uuid, nullable, fk → settlement_records.id)
- Generated Supabase types updated
- `packages/db/src/types.ts` updated with new table shape
- `docs/02_architecture/contracts/settlement_contract.md` updated to reference the table shape

Acceptance: migration applies cleanly; `pnpm test:db` passes with the new table.

### Slice 2 — Settlement Write Path

Deliverables:
- API route: `POST /api/picks/:id/settle`
- Input: `{ outcome, result_source, confidence, notes?, settled_by }`
- Validates: pick exists and is in `posted` lifecycle state
- Creates a `settlement_records` row
- Transitions pick lifecycle from `posted` to `settled`
- Emits an audit event with actor, timestamp, and outcome
- Returns settlement record ID and updated pick lifecycle state
- Unit tests cover:
  - Happy path: pick in `posted` state settles successfully
  - Invalid outcome value: request rejected
  - Pick not in `posted` state: request rejected with clear error
  - Duplicate settlement: creates a correction record linked to original

Acceptance: `pnpm test` passes; route is exercisable in local env.

### Slice 3 — Settlement Read Path

Deliverables:
- Operator snapshot includes `settlement_records` for recently settled picks
- Operator-web dashboard shows `settled` picks with outcome, settled-by, and settled-at
- `settled` picks are visually distinct from `posted` picks in the dashboard
- `GET /api/operator/snapshot` returns settlement rows in the data payload

Acceptance: A pick in `posted` state can be settled through the API and the operator dashboard shows the settled state and outcome without a page reload.

## First Posted-to-Settled Proof

This is the acceptance definition for the first end-to-end proof of settlement.

### Prerequisites

A pick that has completed the live canary path:
- lifecycle state: `posted`
- outbox row: `sent`
- receipt: exists
- Discord message ID: recorded in `system_snapshot.md`

### Steps

1. Call `POST /api/picks/:id/settle` with `{ outcome: "win", result_source: "operator", confidence: "confirmed", settled_by: "operator" }`
2. Verify response: `settlement_records` row created, pick lifecycle transitions to `settled`
3. Verify operator snapshot: pick appears in `settled` state, settlement record visible
4. Verify audit log: settlement event recorded with actor, timestamp, and outcome
5. Verify the Discord receipt and original pick record are unchanged — settlement is additive, not destructive

### Evidence to Record in `docs/06_status/system_snapshot.md`

- pick ID
- settlement record ID
- Discord message ID (from the prior canary post)
- pick lifecycle state: `settled`
- audit log entry ID confirming the settlement event

### Constraint

This proof is performed against a pick that went through `discord:canary`.
It does not require routing through `discord:best-bets` first.

## Settlement Freeze Rule

Do not begin settlement implementation before:

- Week 6 promotion gate exists and CI is hardened (`pnpm test` required in CI)
- All Week 6 blockers in `docs/06_status/status_source_of_truth.md` are cleared
- `discord:best-bets` is either live or explicitly deferred with a documented reason

Reference: `docs/05_operations/week_6_execution_contract.md` — Non-Goals section.
