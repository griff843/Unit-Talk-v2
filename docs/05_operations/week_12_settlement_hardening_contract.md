# Week 12 — Settlement Hardening

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-03-20 |
| Last Updated | 2026-03-21 — Week 11B closed; non-goals updated; authority links corrected |

---

## Objective

Harden the settlement subsystem by closing three known gaps left after the Week 8 implementation:

1. **Manual review resolution** — the Week 8 manual-review path creates an ambiguous-case record and leaves the pick in `posted`. The two-phase resolution (manual-review record → subsequent settlement) is not tested and the operator surface does not show both records.

2. **Correction chain auditability** — the Week 8 correction path writes additive records linked via `corrects_id`. Multi-hop correction chains (correcting a correction) are untested. The `corrects_id` chain is in the DB but not verified in the operator snapshot.

3. **Operator settlement history** — the operator snapshot returns recent settlement rows but does not distinguish `manual_review` records from `settled` records, does not surface `corrects_id`, and may not return all records for picks with multi-record histories.

This week also makes an explicit binding decision on automated settlement input.

---

## Relationship to Week 11B

**Week 11B is formally closed (2026-03-21).** `discord:trader-insights` is live in real channel `1356613995175481405`. Independent verification PASS. Week 12 does not depend on Week 11B in any way and does not affect trader-insights routing or framework code.

---

## Pre-Implementation Baseline

| Check | Required state |
|---|---|
| `pnpm test` | 72/72 |
| `pnpm test:db` | 1/1 |
| Existing settlement tests | 4 passing in `apps/api/src/settlement-service.test.ts` |
| `POST /api/picks/:id/settle` happy path | Live and working |

---

## Scope

### Slice 1 — Manual Review Resolution Path

**The gap**: a pick that receives a `manual_review` settlement record remains in `posted`. The system supports a subsequent `POST /api/picks/:id/settle` with a real settlement result (since the pick is still `posted`), but this path is not explicitly tested and is not visible in the operator surface as a two-record history.

**Deliverables**:

- Test: a pick with a prior `manual_review` record can be settled by a subsequent call; the pick transitions to `settled`; two `settlement_records` rows exist for the pick.
- Test: the prior `manual_review` record is not mutated after the subsequent settlement.
- Operator snapshot: for a pick that was manually reviewed and then settled, both records are returned in the settlement history — not just the latest.
- Operator-web HTML: `manual_review` records are rendered with a distinct label (e.g., `[MANUAL REVIEW]`), clearly separate from settled outcomes.

No schema change is required. The existing table supports this path; the gaps are tests and visibility.

### Slice 2 — Correction Chain Hardening

**The gap**: the Week 8 correction path is tested for one correction only. Multi-hop chains (correcting a correction) are not tested. The `corrects_id` chain is present in the DB but not explicitly surfaced in the operator snapshot.

**Deliverables**:

- Test: correcting a correction — first settlement produces row A; first correction produces row B with `corrects_id = A.id`; second correction produces row C with `corrects_id = B.id`; all three rows exist, none mutated.
- Test: `corrects_id` is present and correct in the operator snapshot API response for correction records.
- Operator-web HTML: correction records are rendered with a distinct label (e.g., `[CORRECTION]`) and include a reference to which record they correct.

### Slice 3 — Operator Settlement History

**The gap**: it is unverified whether (a) all settlement records for a pick are returned vs. only the latest, (b) `manual_review` records are distinguishable in the API response, and (c) `corrects_id` is included in the API response.

**Deliverables**:

- Confirm and test: operator snapshot API response includes `status` (so `manual_review` vs `settled` is distinguishable) for each settlement record.
- Confirm and test: operator snapshot API response includes `corrects_id` for each settlement record.
- Confirm and test: all settlement records for a pick are returned — a pick with a `manual_review` record and a subsequent `settled` record returns both.
- HTML dashboard: `[MANUAL REVIEW]` and `[CORRECTION]` labels render distinctly.

**Scope boundary**: additions only. No redesign of the dashboard layout, no new routes, no new tables. Only surfacing existing DB fields and adding rendering labels.

### Slice 4 — Expanded Test Coverage

The following test scenarios must be covered (by new tests or, if already covered, by existing tests). Each scenario must have at least one test that explicitly asserts the stated behavior.

**Lifecycle-state rejection (missing from existing coverage):**

1. Reject `POST /api/picks/:id/settle` when the pick is in `validated` state — pick not yet `posted`.
2. Reject `POST /api/picks/:id/settle` when the pick is in `queued` state — pick not yet `posted`.
3. Reject `POST /api/picks/:id/settle` when the pick does not exist.

**Input validation (missing from existing coverage):**

4. Reject a `manual_review` request without a `reviewReason` — input is incomplete.

**Two-phase resolution (missing from existing coverage):**

5. `manual_review` record followed by successful settlement → two `settlement_records` rows exist for the pick; pick is `settled`; `manual_review` row is not mutated.
6. Original settlement record fields are unchanged after a correction is applied — explicit immutability assertion.

**Multi-hop correction chain (missing from existing coverage):**

7. Correcting a correction → three settlement records; `corrects_id` chain is: C.corrects_id = B.id, B.corrects_id = A.id; none of A, B, C are mutated.

**Operator visibility (missing from existing coverage):**

8. Operator snapshot settlement records include `status` and `corrects_id` fields.
9. Operator snapshot returns both settlement records for a pick with a `manual_review` record and a subsequent `settled` record.
10. Correction record in operator snapshot has `corrects_id` pointing to the original settlement record ID.

Tests 1–7 belong in `apps/api/src/settlement-service.test.ts` (or a new settlement-specific test file).
Tests 8–10 may be in the operator-web test file or the API server test file.

---

## Automated Settlement Input — Explicit Decision

**Decision: automated settlement input (result_source = 'feed', external data triggers) is NOT in scope for Week 12 and is NOT authorized for any week without a separate written and ratified contract.**

Rationale: The Week 9 readiness decision (`docs/05_operations/week_9_readiness_decision.md`) permits automated settlement to proceed in a future week, but requires:
- A separate written and ratified contract
- Feed reliability proof
- Explicit idempotency design — no external data dependency without an idempotency contract

None of these prerequisites have been written. The `result_source = 'feed'` field exists in the settlement schema but no feed-triggered write path is authorized. This decision is binding for Week 12.

This decision does not preclude a future week contract for automated feeds. When that work becomes a program priority, a dedicated contract must be written first.

---

## Close Criteria

| Criterion | Evidence |
|---|---|
| Slice 1: two-phase resolution path tested (manual_review → settled, both records present) | Test exists and passes |
| Slice 1: `manual_review` record not mutated after subsequent settlement | Test exists and passes |
| Slice 1: operator snapshot returns both records for two-phase picks | Test exists and passes |
| Slice 1: HTML renders `[MANUAL REVIEW]` label for manual-review records | Code read |
| Slice 2: multi-hop correction chain tested (three records, none mutated, `corrects_id` chain intact) | Test exists and passes |
| Slice 2: operator snapshot includes `corrects_id` for correction records | Test exists and passes |
| Slice 2: HTML renders `[CORRECTION]` label for correction records | Code read |
| Slice 3: operator snapshot includes `status` field on settlement records | Test exists and passes |
| Slice 3: all settlement records for a pick returned (not just latest) | Code read or test |
| Slice 4: all 10 scenarios in §Slice 4 are covered by tests | `pnpm test` output |
| No regression in pre-Week-12 settlement tests (4 existing) | `pnpm test` output |
| `pnpm test` passes | ≥ 82 total (72 pre-Week-12 + ≥ 10 new) |
| `pnpm test:db` passes | 1/1 |
| `pnpm type-check` clean | `pnpm verify` |
| `pnpm build` clean | `pnpm verify` |
| Automated settlement decision recorded and explicit | This document §Automated Settlement Input |

---

## Non-Goals

The following are explicitly out of scope for Week 12:

- `discord:trader-insights` — Week 11B closed; no further trader-insights work in Week 12
- `discord:exclusive-insights`, `discord:game-threads`, `discord:strategy-room` — no new channel activation of any kind
- Automated settlement feeds or external data dependencies — see §Automated Settlement Input above
- Multi-leg, parlay, or same-game parlay settlement
- Recap, intelligence, or ranking expansion
- Smart Form expansion — no new intake fields, no new form validation rules, no new intake surfaces
- Broad operator-web redesign or dashboard layout changes beyond the settlement history additions in Slice 3
- New API routes beyond the settlement history visibility changes defined above
- Promotion gate changes
- Routing changes
- Any product surface not currently live

---

## Rollback / Failure Conditions

### Settlement regression

Halt Week 12 and do not continue if any of the following occur:

- Any pre-Week-12 settlement test regresses (4 existing tests)
- `pnpm test:db` fails
- `POST /api/picks/:id/settle` happy path breaks
- Operator settlement snapshot stops returning settlement rows

When triggered:
- Revert Week 12 changes
- Confirm `pnpm test` back to ≥ 72 and `pnpm test:db` passing
- Record in `docs/06_status/week_12_failure_rollback_template.md`

---

## Artifacts

| Purpose | File |
|---|---|
| Proof template | `docs/06_status/week_12_proof_template.md` |
| Failure / rollback template | `docs/06_status/week_12_failure_rollback_template.md` |

---

## Authority Links

| Purpose | File |
|---|---|
| Settlement architectural contract | `docs/02_architecture/contracts/settlement_contract.md` |
| Settlement planning lock | `docs/05_operations/settlement_planning.md` |
| Week 8 settlement runtime contract | `docs/05_operations/week_8_settlement_runtime_contract.md` |
| Week 9 readiness decision | `docs/05_operations/week_9_readiness_decision.md` |
| Program state | `docs/06_status/status_source_of_truth.md` |
