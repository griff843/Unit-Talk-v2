# UTV2-494 — Phase 7A Evidence Bundle

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-494 |
| Tier | T1 |
| Phase / Gate | Phase 7A — Governance Brake |
| Owner | claude/orchestrator |
| Date | 2026-04-11 |
| Verifier Identity | claude/historical-retrofit |
| Commit SHA(s) | 0c95b1e, 144d0de, 71e3b5e, 3797569, c0b0feb, 36f7a52, a66dcd3, c8ebfde |
| Related PRs | #219, #222, #223, #224, #225 |

## Scope

**Claims:**
- All 6 top-level proof assertions pass against live Supabase DB (3 lanes, 11 sub-assertions total)
- Brake applies to autonomous sources (system-pick-scanner, alert-agent, model-driven)
- Governed human/operator paths (smart-form, api, discord-bot, board-construction) are unaffected
- Extended review flow approve/deny/hold works with full audit trail
- Two corrective issues (UTV2-519, UTV2-521) were fixed forward before bundle closure

**Does NOT claim:**
- Stranded-row remediation (24+ pre-UTV2-519 half-state rows — deferred to follow-up)
- Scanner re-enablement (SYSTEM_PICK_SCANNER_ENABLED=false until PM decision)
- Phase 7B work (blocked on bundle acceptance)

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | Non-human-produced picks can land in awaiting_approval | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E1](#e1-brake-applies-to-autonomous-sources) |
| 2 | Those picks do not auto-queue | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E2](#e2-no-auto-queue) |
| 3 | Those picks do not auto-distribute | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E3](#e3-no-auto-distribute) |
| 4 | Existing governed human/operator paths still work | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E4](#e4-human-paths-unaffected) |
| 5 | Approval through extended review flow advances pick into correct next state | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E5](#e5-review-flow-approve) |
| 6 | Reject/void behavior is audit-visible and consistent | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E6](#e6-reject-void-audit) |
| 7 | UTV2-519 regression gate (5/5 PASS against live DB) | test | `t1-proof-awaiting-approval.test.ts` | PASS | [E7](#e7-utv2-519-regression-gate) |
| 8 | UTV2-521 regression gate (5/5 PASS against live DB) | test | `t1-proof-awaiting-approval-review.test.ts` | PASS | [E8](#e8-utv2-521-regression-gate) |
| 9 | Unit tests — review-pick-controller 18/18 PASS | test | `review-pick-controller.test.ts` | PASS | [E9](#e9-unit-tests) |

## Evidence Blocks

### E1 Brake applies to autonomous sources

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-11
Script: `apps/api/src/scripts/utv2-494-phase7a-proof-a-brake.ts` (commit `c8ebfde`)
Result: `RESULT: 3/3 PASS`

Lane A — each autonomous source pick lands in `picks.status='awaiting_approval'`:

| Source | Pick ID | status | approval_status | Lifecycle chain | Brake audit | Outbox rows |
|---|---|---|---|---|---|---|
| system-pick-scanner | `dad42bc3-ddbd-47fc-ba0a-17eb5e5e62d1` | awaiting_approval | approved | `null -> validated (submitter)` -> `validated -> awaiting_approval (promoter)` | 1 | 0 |
| alert-agent | `602a7a60-09df-4af0-9c87-e973411d377f` | awaiting_approval | approved | `null -> validated (submitter)` -> `validated -> awaiting_approval (promoter)` | 1 | 0 |
| model-driven | `db08bb83-b5ef-41e7-9501-f75282e720b2` | awaiting_approval | approved | `null -> validated (submitter)` -> `validated -> awaiting_approval (promoter)` | 1 | 0 |

Submission response shape (all 3): `http=201, lifecycleState='awaiting_approval', governanceBrake=true, outboxEnqueued=false`.

### E2 No auto-queue

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-11
Evidence: All 3 braked picks have `status='awaiting_approval'` (not `queued`). Lifecycle chain shows no transition to `queued`. Zero outbox rows for any braked pick id.

### E3 No auto-distribute

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-11
Evidence: `distribution_outbox` count = 0 for all braked pick IDs. Delivery requires an outbox row for the worker to claim — zero rows means distribution cannot start.

### E4 Human paths unaffected

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10 (pre-merge, preserved — brake semantics for human paths did not change post-UTV2-519/521)
Script: `apps/api/src/scripts/utv2-494-phase7a-proof-b-human.ts`
Result: `RESULT: 4/4 PASS` (B1-B4)

| Source | Pick ID | status | approval_status | promotion_status | Outbox | Brake event |
|---|---|---|---|---|---|---|
| smart-form | `b3ab14eb-0bbd-4537-be0b-e6d4065f614a` | queued | approved | qualified | 1 | 0 |
| api | `45740fa6-b302-4dbc-b0cf-8c5244e298e6` | validated | approved | not_eligible | 0 | 0 |
| discord-bot | `602e7294-68ad-44dd-82bf-7f6dd086212b` | validated | approved | not_eligible | 0 | 0 |
| board-construction | `efc53dd8-ba3c-4dc2-9966-ff6a5b80358e` | validated | approved | not_eligible | 0 | 0 |

smart-form is the canonical human-relayed success case: `status=queued`, outbox row present. api/discord-bot/board-construction reach `validated` (NOT `awaiting_approval`) with no brake event. board-construction additionally proves the PM regression correction in UTV2-492.

### E5 Review flow approve

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-11
Script: `apps/api/src/scripts/utv2-494-phase7a-proof-c-review.ts`
Result: `RESULT: 4/4 PASS` (C1-C4)

Approve path (C1): `system-pick-scanner` pick transitions `awaiting_approval -> queued` via `operator_override`, with `review.approve` audit row carrying `previousLifecycleState='awaiting_approval'`.

| Lane | Pick ID | Source | Final status | approval_status | Review decision | Audit action |
|---|---|---|---|---|---|---|
| C1 approve | `0909a6b3-5264-4a19-8e8d-f4537eb628db` | system-pick-scanner | queued | approved | approve | review.approve |

### E6 Reject void audit

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-11

| Lane | Pick ID | Source | Final status | approval_status | Review decision | Audit action |
|---|---|---|---|---|---|---|
| C2 deny | `54a70fad-a68c-4f86-8183-28f871f9949d` | alert-agent | voided | rejected | deny | review.deny |
| C3 hold | `12581d11-6433-42d1-b7bc-d8c3a17c819f` | model-driven | awaiting_approval | approved | hold | review.hold |

C2 deny: pick moves to `voided`, lifecycle row written, `review.deny` in audit with `previousLifecycleState='awaiting_approval'`.
C3 hold: pick stays in `awaiting_approval`, no new lifecycle transition, `review.hold` audit row exists, `approval_status` unchanged.
C4 audit coherence: `actionsConfirmed: ["review.approve", "review.deny", "review.hold"]` — each action found on corresponding pick.

### E7 UTV2-519 regression gate

**Test evidence**
Test: `t1-proof-awaiting-approval.test.ts`
Command: `pnpm test:db`
Result: 5/5 PASS against live DB

Fixtures:
- `20ad490e` (system-pick-scanner) — full brake chain
- `a2b29768` (alert-agent) — full brake chain
- `1ec7fee5` (model-driven) — full brake chain
- Atomic rollback regression fixture (mismatched fromState correctly rejected)

### E8 UTV2-521 regression gate

**Test evidence**
Test: `t1-proof-awaiting-approval-review.test.ts`
Command: `pnpm test:db`
Result: 5/5 PASS against live DB

Fixtures:
- `16bd1390` (system-pick-scanner, approve) — transitioned to queued
- `84b1f4a0` (alert-agent, deny) — transitioned to voided
- `1da08174` (model-driven, hold) — no transition, audit written
- `ba5a3400` (regression, non-governance non-pending) — NOT_PENDING guard still fires

### E9 Unit tests

**Test evidence**
Test: `review-pick-controller.test.ts`
Command: `tsx --test apps/api/src/review-pick-controller.test.ts`
Result: 18/18 PASS; packages/db 106/106; root pnpm test clean

### Corrective Work Notes

**UTV2-519** fixed a schema gap: `pick_lifecycle_to_state_check` did not include `awaiting_approval`, and `transitionPickLifecycle` was non-atomic. Shipped DDL fix plus atomic PL/pgSQL RPC (`public.transition_pick_lifecycle`).

**UTV2-521** fixed a runtime gap: the extended review controller was unreachable for brake picks because the existing `NOT_PENDING` guard fired first. Relaxed the guard to recognize `status='awaiting_approval'` as a distinct governance-review lane.

### Phase 7A Delivery Summary

| Issue | Title | Merge commit | PR |
|---|---|---|---|
| UTV2-491 | P7A-01: Add awaiting_approval lifecycle state | `0c95b1e` | — |
| UTV2-492 | P7A-02: Gate the real queueing path | `144d0de` | #222 |
| UTV2-493 | P7A-03: Extend existing review flow umbrella | (umbrella) | — |
| UTV2-509 | P7A-03a: Extend review controller semantics | `71e3b5e` | #219 |
| UTV2-510 | P7A-03b: Extend operator-web read surfaces | `3797569` | — |
| UTV2-511 | P7A-03c: Extend command-center review/held surfaces | `c0b0feb` | — |
| UTV2-519 | P7A-04: Atomic lifecycle transition + brake proof (corrective) | `36f7a52` | #223 |
| UTV2-521 | P7A-06: Review controller accepts decisions on awaiting_approval (corrective) | `a66dcd3` | #224 |
| UTV2-522 | Lane A proof script hygiene | `c8ebfde` | #225 |
| UTV2-494 | P7A-99: Phase 7A proof bundle (this document) | — | — |

### Runtime Snapshot

| Dimension | Value |
|---|---|
| Main HEAD | `c8ebfde` |
| Live DB | `feownrheeefbcsehtsiw` |
| pick_lifecycle_to_state_check | Includes `awaiting_approval` (UTV2-519 DDL) |
| public.transition_pick_lifecycle | Atomic PL/pgSQL RPC (UTV2-519) |
| GOVERNANCE_BRAKE_SOURCES | `{ system-pick-scanner, alert-agent, model-driven }` |
| SYSTEM_PICK_SCANNER_ENABLED | `false` |
| Stranded rows | 24+ pre-UTV2-519 half-state rows (deferred) |

### Open Items Deliberately Out of Scope

- Stranded-row remediation — 24+ pre-UTV2-519 half-state rows remain. Deferred to follow-up.
- Scanner re-enablement — stays off until PM decision.
- UTV2-520 — P7A-05 hardening + debt follow-up.
- Phase 7B — blocked on bundle acceptance.

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| Non-human-produced picks can land in awaiting_approval | 1 |
| Those picks do not auto-queue | 2 |
| Those picks do not auto-distribute | 3 |
| Existing governed human/operator paths still work | 4 |
| Approval through extended review flow advances pick into correct next state | 5 |
| Reject/void behavior is audit-visible and consistent | 6 |

## Stop Conditions Encountered

- 2026-04-10: UTV2-519 — `pick_lifecycle_to_state_check` constraint missing `awaiting_approval`, `transitionPickLifecycle` non-atomic. Escalated. Resolution: corrective DDL + atomic RPC shipped before bundle closed.
- 2026-04-11: UTV2-521 — Review controller `NOT_PENDING` guard blocked brake picks. Escalated. Resolution: guard relaxed to recognize `awaiting_approval` governance-review lane, shipped before bundle closed.

## Sign-off

**Verifier:** claude/historical-retrofit — 2026-04-11
**PM acceptance:** historical — accepted at original gate closure
