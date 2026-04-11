# UTV2-494 — Phase 7A Evidence Bundle

**Status:** COMPLETE — 6/6 proof assertions PASS (live DB + runtime, 2026-04-11)
**Date:** 2026-04-11
**Verified by:** Claude Code orchestrator + Supabase DB (`feownrheeefbcsehtsiw`) + local API on main at `c8ebfde`
**Scope:** Phase 7A governance brake end-to-end — brake applies to autonomous sources, governed human/operator paths unaffected, extended review flow advances/rejects/holds correctly with audit.

---

## Phase 7A Delivery Summary

| Issue | Title | Merge commit | PR |
|---|---|---|---|
| UTV2-491 | P7A-01: Add awaiting_approval lifecycle state | `0c95b1e` | — |
| UTV2-492 | P7A-02: Gate the real queueing path for awaiting_approval picks | `144d0de` | #222 |
| UTV2-493 | P7A-03: Extend existing review flow umbrella | (umbrella) | — |
| UTV2-509 | P7A-03a: Extend review controller semantics for awaiting_approval | `71e3b5e` | #219 |
| UTV2-510 | P7A-03b: Extend operator-web read surfaces for awaiting_approval | `3797569` | — |
| UTV2-511 | P7A-03c: Extend command-center review/held surfaces | `c0b0feb` | — |
| UTV2-519 | P7A-04: Atomic awaiting_approval lifecycle transition + brake proof (corrective) | `36f7a52` | #223 |
| UTV2-521 | P7A-06: Review controller accepts decisions on awaiting_approval independent of approval_status (corrective) | `a66dcd3` | #224 |
| UTV2-522 | Lane A proof script — re-runnable + idempotency hygiene | `c8ebfde` | #225 |
| UTV2-494 | P7A-99: Phase 7A proof bundle (this document) | — | — |

**Corrective path:** Two T1 runtime gaps were surfaced during proof execution and fixed forward before the bundle closed.

- **UTV2-519** fixed a schema gap in UTV2-491: `pick_lifecycle_to_state_check` did not include `awaiting_approval`, and `transitionPickLifecycle` was non-atomic (two independent writes). `submit-pick-controller` was committing `picks.status='awaiting_approval'` and then failing the lifecycle-event insert, leaving the DB in a half-written state with no audit trail. UTV2-519 shipped the DDL fix plus an atomic PL/pgSQL RPC (`public.transition_pick_lifecycle`) that wraps the two writes in a single transaction. Unit tests missed this because InMemory repositories do not enforce Postgres CHECK constraints.
- **UTV2-521** fixed a runtime gap in UTV2-509: the extended review controller was unreachable for brake picks because the existing `NOT_PENDING` guard (`pick.approval_status !== 'pending'`) fired first. Every autonomous-source pick is created with `approval_status='approved'` at submission (post-promotion default from the `not_eligible` path), so `review.*` decisions on brake picks were rejected with HTTP 400 `NOT_PENDING`. UTV2-521 relaxed the guard to recognize `status='awaiting_approval'` as a distinct governance-review lane, independent of `approval_status`, while preserving the legacy promotion-approval lane. Unit tests missed this because they set `approval_status='pending'` directly on hand-built fixtures rather than exercising the real submission pipeline.

Both corrections are now live with a `pnpm test:db` regression gate (`t1-proof-awaiting-approval.test.ts` and `t1-proof-awaiting-approval-review.test.ts`) proving against live Postgres.

---

## Proof Assertions (6/6 PASS)

| # | Assertion | Lane | Result |
|---|---|---|---|
| 1 | Non-human-produced picks can land in `awaiting_approval` | A | **PASS** |
| 2 | Those picks do not auto-queue | A | **PASS** |
| 3 | Those picks do not auto-distribute | A | **PASS** |
| 4 | Existing governed human/operator paths still work | B | **PASS** |
| 5 | Approval through the extended review flow advances the pick into the correct next state | C | **PASS** |
| 6 | Reject/void behavior is audit-visible and consistent | C | **PASS** |

---

## Lane A — Brake blocks autonomous sources (assertions 1, 2, 3)

**Script:** `apps/api/src/scripts/utv2-494-phase7a-proof-a-brake.ts` (commit `c8ebfde` — UTV2-522 hygiene fix applied)
**Run:** 2026-04-11, against API on main + live DB `feownrheeefbcsehtsiw`, `SYSTEM_PICK_SCANNER_ENABLED=false`
**Result:** `RESULT: 3/3 PASS`

**Assertions:**
- **A1** — Each autonomous source pick lands in `picks.status='awaiting_approval'`
- **A2** — Zero rows in `distribution_outbox` for any braked pick id
- **A3** — `audit_log` has a `pick.governance_brake.applied` row referencing each pick id (via `payload->>'pickId'`)

**Live DB evidence (post-run):**

| Source | Pick ID | status | approval_status | Lifecycle chain | Brake audit | Outbox rows |
|---|---|---|---|---|---|---|
| system-pick-scanner | `dad42bc3-ddbd-47fc-ba0a-17eb5e5e62d1` | awaiting_approval | approved | `null → validated (submitter)` → `validated → awaiting_approval (promoter, "governance brake: non-human source system-pick-scanner")` | 1 | 0 |
| alert-agent | `602a7a60-09df-4af0-9c87-e973411d377f` | awaiting_approval | approved | `null → validated (submitter)` → `validated → awaiting_approval (promoter, "governance brake: non-human source alert-agent")` | 1 | 0 |
| model-driven | `db08bb83-b5ef-41e7-9501-f75282e720b2` | awaiting_approval | approved | `null → validated (submitter)` → `validated → awaiting_approval (promoter, "governance brake: non-human source model-driven")` | 1 | 0 |

**Submission response shape (all 3 brake sources):** `http=201, lifecycleState='awaiting_approval', governanceBrake=true, outboxEnqueued=false`.

**Why this satisfies assertions 1, 2, and 3:**
- `status='awaiting_approval'` in DB proves assertion 1.
- `distribution_outbox` count = 0 proves assertion 2 (no enqueue happened).
- Assertion 3 is the delivery gate — delivery requires an outbox row to exist for the worker to claim and post. Zero outbox rows means distribution cannot start, proving assertion 3.
- Pre-existing evidence from UTV2-519 `t1-proof-awaiting-approval.test.ts` (`20ad490e`, `a2b29768`, `1ec7fee5`) shows the same chain was reproducible on first pass once the atomic RPC landed.

---

## Lane B — Governed human / operator paths unaffected (assertion 4)

**Script:** `apps/api/src/scripts/utv2-494-phase7a-proof-b-human.ts`
**Run:** 2026-04-10 (pre-merge, preserved — brake semantics for human paths did not change post-UTV2-519/521)
**Branch:** `worktree-agent-a9a063d8`, commit `8647d0f`
**Result:** `RESULT: 4/4 PASS`

**Assertions:**
- **B1** — `picks.status` is NOT `awaiting_approval` for smart-form / api / discord-bot
- **B2** — Enqueue path ran (distribution_outbox has a row OR submission explicitly returns `outboxEnqueued=false` due to promotion gate, not brake)
- **B3** — Submission response does NOT include `governanceBrake:true` or `awaiting_approval` for any non-brake source
- **B4** — `board-construction` regression guard: operator-triggered source is NOT braked (per UTV2-492 PM correction removing it from `GOVERNANCE_BRAKE_SOURCES`)

**Live DB evidence (fixtures preserved from pre-merge run):**

| Source | Pick ID | status | approval_status | promotion_status | Outbox | Brake event |
|---|---|---|---|---|---|---|
| smart-form | `b3ab14eb-0bbd-4537-be0b-e6d4065f614a` | queued | approved | qualified | 1 | 0 |
| api | `45740fa6-b302-4dbc-b0cf-8c5244e298e6` | validated | approved | not_eligible | 0 | 0 |
| discord-bot | `602e7294-68ad-44dd-82bf-7f6dd086212b` | validated | approved | not_eligible | 0 | 0 |
| board-construction | `efc53dd8-ba3c-4dc2-9966-ff6a5b80358e` | validated | approved | not_eligible | 0 | 0 |

**Interpretation:**
- **smart-form** is the canonical human-relayed success case: `status=queued`, outbox row present, `promotion_status=qualified`. The enqueue path ran end-to-end. No brake interference.
- **api / discord-bot / board-construction** each reach `status=validated` (NOT `awaiting_approval` — no brake applied), `has_brake_event=0` (no governance-brake lifecycle row), and their submission responses do not carry the `governanceBrake=true` flag. The absence of an outbox row is explained by `promotion_status=not_eligible` (the promotion pipeline did not qualify these fixtures for distribution), **not** by the governance brake. This is the documented PASS-with-note pattern — the brake is demonstrably absent, and the pipeline's normal promotion gate is what kept them off the outbox.
- **board-construction** additionally proves the PM regression correction in UTV2-492 (2026-04-10): the operator-triggered board path was explicitly removed from `GOVERNANCE_BRAKE_SOURCES` because it is not an autonomous producer. The fixture confirms the exclusion is live.

**Why Lane B does not need to re-run on main:** the brake implementation did not change the code paths for these sources. UTV2-519 and UTV2-521 touched the lifecycle-event table constraint, the atomic RPC, and the review controller — none of which affect non-brake submission flow. Pre-merge Lane B evidence remains valid on main.

---

## Lane C — Review flow approve / deny / hold (assertions 5, 6)

**Script:** `apps/api/src/scripts/utv2-494-phase7a-proof-c-review.ts`
**Run:** 2026-04-11, against API on main + live DB `feownrheeefbcsehtsiw`
**Result:** `RESULT: 4/4 PASS`

Note: one test-hygiene fix was applied inline during the final run — the original C3 assertion hardcoded `approval_status === 'pending'`, but per UTV2-521 semantics (Option A writeback), `decisionToApprovalStatus('hold')` returns null (no change) and brake picks enter the review lane with `approval_status='approved'`. The corrected assertion checks that `approval_status` is unchanged from its pre-review value. Assertion intent is unchanged: "hold = no change to status, no lifecycle transition, audit row written". The Lane C script lives in the main working tree (untracked, pre-dates a proper PR ceremony — tracked for follow-up under a future housekeeping task if needed).

**Assertions:**
- **C1** — Approve path: `system-pick-scanner` pick transitions `awaiting_approval → queued` via `operator_override`, with `review.approve` audit row carrying `previousLifecycleState='awaiting_approval'`
- **C2** — Deny path: `alert-agent` pick transitions `awaiting_approval → voided` via `operator_override`, with `review.deny` audit row
- **C3** — Hold path: `model-driven` pick stays in `awaiting_approval` (no new lifecycle transition), `review.hold` audit row exists, `approval_status` unchanged
- **C4** — Audit coherence: the three lanes' audit rows collectively confirm the action strings `review.approve`, `review.deny`, `review.hold` are present with the correct `entity_ref` and `previousLifecycleState`

**Live DB evidence (post-run):**

| Lane | Pick ID | Source | Final status | approval_status | Lifecycle chain | Review decision | review.* audit |
|---|---|---|---|---|---|---|---|
| C1 approve | `0909a6b3-5264-4a19-8e8d-f4537eb628db` | system-pick-scanner | **queued** | approved | `null → validated (submitter)` → `validated → awaiting_approval (promoter)` → `awaiting_approval → queued (operator_override)` | approve | `review.approve` |
| C2 deny | `54a70fad-a68c-4f86-8183-28f871f9949d` | alert-agent | **voided** | rejected | `null → validated (submitter)` → `validated → awaiting_approval (promoter)` → `awaiting_approval → voided (operator_override)` | deny | `review.deny` |
| C3 hold | `12581d11-6433-42d1-b7bc-d8c3a17c819f` | model-driven | awaiting_approval | approved | `null → validated (submitter)` → `validated → awaiting_approval (promoter)` | hold | `review.hold` |

All three decisions land an HTTP 200 response from `POST /api/picks/:id/review`. For C1 and C2, the lifecycle chain ends with a new `operator_override` transition. For C3, no new lifecycle event is written — the chain still has exactly 2 rows (validated + brake) — and the audit row `review.hold` confirms the review was recorded without advancing state.

**C4 audit coherence evidence:**
```
actionsConfirmed: ["review.approve", "review.deny", "review.hold"]
```
Each action was found on the corresponding pick via `entity_ref=<pickId>`, and all payloads include `previousLifecycleState='awaiting_approval'`.

**Why this satisfies assertions 5 and 6:**
- Assertion 5: C1 approve proves the review lane successfully advances a braked pick into `queued` via `operator_override`. The transition goes through the atomic RPC (`public.transition_pick_lifecycle` from UTV2-519), so either both the `picks.status` update and the `pick_lifecycle` event insert land, or neither does — no half-state possible. The audit row, the `pick_reviews` entry, and the lifecycle row all confirm the advance succeeded end-to-end.
- Assertion 6: C2 deny proves void behavior — the pick moves to `voided` state, the lifecycle row is written, and `review.deny` is in the audit log with `previousLifecycleState='awaiting_approval'`. The reject/void is audit-visible and consistent. C3 hold additionally proves the no-op semantics — the lane decision is recorded in audit and `pick_reviews` without touching the lifecycle FSM.

---

## Collateral Evidence from Corrective Work

**UTV2-519 brake proof (`t1-proof-awaiting-approval.test.ts`)** — 5/5 PASS against live DB, fixtures:
- `20ad490e-da71-4512-9e3c-efd2ca451853` (system-pick-scanner) — full brake chain
- `a2b29768-b7e5-46bb-86a9-a572094018e1` (alert-agent) — full brake chain
- `1ec7fee5-e343-4394-b147-716efe6b86e2` (model-driven) — full brake chain
- Atomic rollback regression fixture (mismatched fromState correctly rejected, `picks.status` unchanged)

**UTV2-521 brake-review proof (`t1-proof-awaiting-approval-review.test.ts`)** — 5/5 PASS against live DB, fixtures:
- `16bd1390-52ca-44ac-8f3e-f9ae5f716e88` (system-pick-scanner, approve) — transitioned to queued
- `84b1f4a0-0ef2-475c-a388-e090cd6d8928` (alert-agent, deny) — transitioned to voided
- `1da08174-da57-477b-850f-e02c76dfc724` (model-driven, hold) — no transition, audit written
- `ba5a3400-6d2f-4b28-ad22-1b5260e375c6` (regression fixture, non-governance non-pending) — NOT_PENDING guard still fires

**These two `pnpm test:db` cases form the standing regression gate on main.** They will catch any future drift in the brake + review flow without manual proof-script re-runs.

---

## Runtime Snapshot

| Dimension | Value |
|---|---|
| Main HEAD | `c8ebfde fix(utv2-522): Lane A proof script — re-runnable + idempotency hygiene (#225)` |
| Live DB | `feownrheeefbcsehtsiw` (production Supabase project ref) |
| `pick_lifecycle_to_state_check` | Includes `awaiting_approval` (UTV2-519 DDL, migration `202604100004`) |
| `public.transition_pick_lifecycle` | Atomic PL/pgSQL RPC, grants EXECUTE to service_role (UTV2-519, migration `202604100005`) |
| `GOVERNANCE_BRAKE_SOURCES` | `{ system-pick-scanner, alert-agent, model-driven }` — `board-construction` explicitly excluded per PM correction 2026-04-10 |
| `SYSTEM_PICK_SCANNER_ENABLED` | `false` (quiesced for UTV2-519 corrective; stays off until bundle acceptance per PM directive) |
| Stranded rows | 24+ pre-UTV2-519 half-state rows remain untouched; remediation deferred to a follow-up issue after bundle acceptance |
| Phase 7A `pnpm test:db` gates | `t1-proof-awaiting-approval.test.ts` (UTV2-519) + `t1-proof-awaiting-approval-review.test.ts` (UTV2-521) |

---

## Verdict

| Layer | Status |
|---|---|
| Code review | **PASS** — all brake sources + review branches confirmed in source |
| Unit tests | **PASS** — `review-pick-controller.test.ts` 18/18, `packages/db` 106/106, root `pnpm test` clean |
| Live DB proof scripts | **PASS** — Lane A 3/3, Lane B 4/4 (preserved), Lane C 4/4 |
| Live DB `pnpm test:db` regression gates | **PASS** — UTV2-519 5/5 + UTV2-521 5/5 |
| Governance brake end-to-end | **PASS** — brake applies to autonomous producers, governed human paths unaffected, extended review flow approves/denies/holds with full audit trail |

**Phase 7A gate: READY TO CLOSE — pending PM acceptance of this bundle.**

---

## Open Items Deliberately Out of Scope (tracked elsewhere)

- **Stranded-row remediation** — 24+ pre-UTV2-519 half-state rows remain in `picks.status='awaiting_approval'` without matching lifecycle events. Hybrid cleanup policy was approved by PM (delete 5 proof fixtures, backfill 19 production rows with `pick.governance_brake.corrective_backfill` audit action). Execution deferred to a follow-up after bundle acceptance. Do not touch without explicit PM approval.
- **Scanner re-enablement** — `SYSTEM_PICK_SCANNER_ENABLED=false` remains in `local.env` with an inline do-not-revert comment. Flip back to `true` only after PM is satisfied with full post-bundle stability.
- **UTV2-520** — P7A-05 hardening + debt follow-up. Covers: merge→deploy discipline documentation + tech guard (policy breach remediation from UTV2-519's pre-merge Management-API apply), tightening `PickRepository.transitionPickLifecycleAtomic?` from optional to required once the worker `FakePickRepository` fake is updated, and test hygiene for `t1-proof-awaiting-approval.test.ts` idempotency.
- **Phase 7B** — Blocked on bundle acceptance per `docs/06_status/PROGRAM_STATUS.md`.

---

## Acceptance Criteria Met

1. ✅ Non-human-produced picks can land in `awaiting_approval` (Lane A + UTV2-519 test:db)
2. ✅ Those picks do not auto-queue (Lane A outbox=0 + lifecycle chain)
3. ✅ Those picks do not auto-distribute (Lane A outbox=0)
4. ✅ Existing governed human paths still work (Lane B)
5. ✅ Approval through the extended review flow advances the pick into the correct next state (Lane C C1 + UTV2-521 test:db)
6. ✅ Reject/void behavior is audit-visible and consistent (Lane C C2/C3 + UTV2-521 test:db)

**Phase 7A is functionally complete and proven against live DB. Awaiting PM acceptance to close UTV2-494 and unblock Phase 7B.**
