# Phase 7R — Ratification Evidence Bundle

> **Authority tier:** T1
> **Linear issue:** UTV2-485
> **Status:** draft — pending PM acceptance
> **Grounded against:** code at HEAD `154f27a` (2026-04-10)
> **Supersedes:** nothing (new artifact)

This document is the repo-grounded evidence bundle for the Phase 7 ratification gate (UTV2-485). Every acceptance criterion listed in UTV2-485 is answered here with a verifiable fact. No Phase 7A implementation issue may move to Ready until PM accepts this bundle.

---

## 1. Acceptance Criterion Results

| # | AC | Result | Evidence |
|---|---|---|---|
| 1 | Phase 7 charter is ratified as the active planning source | PASS (pending PM sign-off) | See §2. `docs/06_status/PHASE7_PLAN_DRAFT.md` remains the working draft; Linear project "Phase 7 - Governed Syndicate Machine" (24 issues) is the canonical execution queue. The draft doc is **not** promoted to non-draft state in this pass — the Linear issues are the authority, the draft is supplementary. |
| 2 | Readiness surfaces no longer point at a conflicting active sprint narrative | NEEDS-FIX | `docs/06_status/PROGRAM_STATUS.md` line 80 positioning statement is stale and must be corrected. See §3. |
| 3 | Current direct-producer flags and governed-machine flags recorded as facts | PASS | See §4. |
| 4 | Existing review-flow surfaces audited and summarized for 7A | PASS | See §5. |
| 5 | Next migration slot and active file-collision risk verified | PASS | See §6. |

**Overall:** 4/5 PASS, 1 NEEDS-FIX. The NEEDS-FIX item (PROGRAM_STATUS.md positioning statement) is addressed in this same ratification PR via an edit to that file.

---

## 2. Charter ratification

**Decision:** The Linear project "Phase 7 - Governed Syndicate Machine" (24 issues, UTV2-485 through UTV2-508) is the canonical execution charter. `docs/06_status/PHASE7_PLAN_DRAFT.md` is retained as a supplementary draft and is **not** the source of truth.

**Why:** The Linear issues were rewritten with repo-grounded allowed/forbidden files and repo-truth scope notes (see UTV2-491 and UTV2-492 descriptions in particular). The plan draft was written before the Codex adversarial review and contains language that has since been superseded by the Linear issue bodies. Rather than re-editing the draft to track Linear, we treat Linear as authoritative and the draft as a historical design artifact.

**Known deltas between the draft and Linear reality:**

| Plan draft language | Linear reality | Action |
|---|---|---|
| Invents env flag `ALERT_AGENT_AUTOSUBMIT_ENABLED` | Real flag is `ALERT_AGENT_ENABLED` (default `true`) | UTV2-497 (P7B-03) will correct this — the real flag is already tracked in the issue scope as "use only real repo/runtime flags" |
| P7A-01 packet tells operator to apply via Supabase dashboard + `supabase migration repair` | UTV2-491 description forbids that language and requires the normal repo-backed migration flow | Already corrected in Linear |
| P7A-06 packet forbids `apps/api` edits but requires the approve action to call a new `apps/api` write endpoint | UTV2-493 description reuses the existing `review-pick-controller.ts` via the existing `POST /api/picks/:id/review` route — no scope contradiction | Already corrected in Linear |
| P7C-03 packet has an Option A/B design fork hidden in a migration-only scope | UTV2-501 (P7C-03) is scoped as a **proof** issue ("prove recorded tuning is actually consumed by runtime"), not the Option A/B migration choice — the design fork has been removed | Already corrected in Linear |

**Open Codex adversarial findings: all three are either resolved in Linear or explicitly scoped out. No new fixes needed before 7A starts.**

---

## 3. PROGRAM_STATUS.md reconciliation

### 3.1 Stale positioning statement (fix required)

**File:** `docs/06_status/PROGRAM_STATUS.md` line 80

**Current text:**

> Launch positioning: Pick operations + distribution + tracking platform with real market edge computation. Sprint D (Intelligence v1) is complete. NOT a syndicate-level intelligence system — that requires Phase 7 (feedback loop, 500+ graded picks, UX hardening).

**Problem:** This sentence was written when Phase 7 was imagined as feedback-loop + UX hardening. Phase 7 has since been redirected to **governance-first** (ratification → governance brake → ingress unification → closed loop → real model layer → calibration). Treating Phase 7 as "feedback loop + 500+ graded picks" misstates the active charter and confuses any reader who follows PROGRAM_STATUS as truth.

**Correction (to be applied in this same ratification pass):** replace with a statement that references the active Phase 7 charter governance-first direction.

### 3.2 Historical sections below the "Last Updated" block

The rest of PROGRAM_STATUS.md still contains M13 milestone tables, "Sprint A resolved" notes, and Gate Notes from 2026-04-08. These are historical and do not contradict Phase 7 — they document the closed milestones. **No change needed** beyond the §3.1 correction and a new Phase 7 section near the top.

### 3.3 Other authority surfaces checked

- `docs/05_operations/docs_authority_map.md` — not re-read in this pass; no known conflict with Phase 7
- `docs/06_status/ISSUE_QUEUE.md` — historical record per CLAUDE.md, Linear is the live queue, no action needed
- `docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md` §2.5 — contains the "parallel by design" language for system-pick-scanner that UTV2-497 (P7B-03) will amend. **Do not amend in the ratification pass** — UTV2-497 owns that edit.

---

## 4. Runtime feature flag state (recorded as facts)

Verified against `.env.example`, runtime code, and live `process.env` defaults. **Production env state must be confirmed by Ops before the first 7A issue merges** — this section records the repo-level defaults and the intent.

| Flag | Default (repo) | Where defined | Current meaning | Phase 7 relevance |
|---|---|---|---|---|
| `SYSTEM_PICK_SCANNER_ENABLED` | `false` | `.env.example:92`, `apps/api/src/system-pick-scanner.ts:50` | Scanner scheduler is a no-op. **Not currently a live producer in prod** assuming env follows `.env.example`. | UTV2-495 (P7B-01) converts this producer; the gate stays at default false throughout the transition. |
| `SYNDICATE_MACHINE_ENABLED` | `false` | `apps/api/src/board-scan-service.ts:53`, `docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md:298` | Board scan is a no-op. **The entire governed Phase 2-6 pipeline (market_universe → pick_candidates → syndicate_board → board-pick-writer) is dormant in prod.** | Phase 7A's brake applies when this flag flips ON. Until then, the governed pipeline does not produce any picks — so Phase 7A's brake is primarily protecting against `ALERT_AGENT_ENABLED` (below) and future activation of this flag. |
| `ALERT_AGENT_ENABLED` | `true` | `.env.example:61`, `apps/api/src/alert-agent-service.ts:99` | Alert agent detection + direct submission is **ON by default**. This is the current live autonomous pick producer. | **This is the single real Phase 7A target in production today.** Every "non-human producer auto-distributes" scenario referenced in the Linear issues refers to this path right now. UTV2-496 (P7B-02) retires it. |
| `ALERT_AGENT_AUTOSUBMIT_ENABLED` | **DOES NOT EXIST** | n/a | This flag was invented in the plan draft. Real flag is `ALERT_AGENT_ENABLED`. | UTV2-497 (P7B-03) must ensure no issue packet references the invented name. |

**Implications for Phase 7A sequencing:**

1. The only live autonomous producer today is `alert-agent`. Phase 7A's brake lands in the lifecycle FSM and queueing path (UTV2-491, UTV2-492), and Phase 7B's second issue (UTV2-496) is what actually converts `alert-agent` to go through the governed upstream path.
2. `system-pick-scanner` and `SYNDICATE_MACHINE_ENABLED` pipelines are both dormant. Phase 7A is protecting **against future activation** of them, not against current runtime behavior.
3. **Do not turn on `SYNDICATE_MACHINE_ENABLED` or `SYSTEM_PICK_SCANNER_ENABLED` in production** during the Phase 7A transition. If they're already on in prod (Ops must verify), they must be turned off before Phase 7A merges OR the brake in UTV2-491/492 must be proven ahead of enablement.
4. `ALERT_AGENT_ENABLED=true` can remain on **only until UTV2-496 ships**, because alert-agent is currently a direct `/api/submissions` producer. Once UTV2-491 and UTV2-492 land, alert-agent submissions will still work — they will just land in `awaiting_approval` and wait for human approval via the CC review queue (UTV2-493).

---

## 5. Existing review-flow audit (for UTV2-493 / P7A-03)

### 5.1 API controller

**File:** `apps/api/src/controllers/review-pick-controller.ts` (151 lines)

**Behavior:**
- Handles decisions: `approve` | `deny` | `hold` | `return` (line 6)
- Validates pick is in `approval_status === 'pending'` before allowing `approve`/`deny`/`hold` (line 66-68)
- On `approve`: updates `approval_status` to `'approved'`, triggers `evaluateAllPoliciesEagerAndPersist` (line 101-111)
- On `deny`: updates `approval_status` to `'rejected'`
- On `hold`: records review, leaves approval_status untouched
- On `return`: only valid from prior `hold` state; leaves approval_status untouched
- Writes audit log with `entityType: 'pick_review'` and full decision payload
- Uses `repositories.reviews.createReview` (pick_reviews table)

**Structural truth:** This controller is **already the right extension point for Phase 7A**. It already:
- Gates on `approval_status === 'pending'` (exactly the condition UTV2-491 will create for autonomous producers)
- Triggers eager promotion re-evaluation on approve (which cascades into enqueue)
- Writes audit log

**What UTV2-493 needs to add (minimal):**
1. On `approve`: also transition `lifecycleState` from `awaiting_approval` → `validated` (or directly to `queued` — decision belongs in UTV2-493 scope)
2. On `deny`: also transition `lifecycleState` from `awaiting_approval` → `voided` (terminal)
3. Preserve the existing human-pending path (which already lands in pending via the current review flow and should not be affected)

**What UTV2-493 must NOT do:**
- Build a greenfield approval subsystem
- Add a new approval endpoint with a different URL
- Duplicate the audit logic
- Break the existing `return` semantics

### 5.2 CC review surface

**Files found on main:**
- `apps/command-center/src/app/review/page.tsx` — review queue page
- `apps/command-center/src/components/ReviewQueueClient.tsx` — client-side table
- `apps/command-center/src/components/ReviewActions.tsx` — approve/deny/hold/return buttons
- `apps/command-center/src/components/BulkReviewBar.tsx` — bulk operations
- `apps/command-center/src/app/actions/review.ts` — server action that calls the API controller

**Structural truth:** A full CC review UI already exists. UTV2-493 should:
- Add `awaiting_approval` picks to the review queue listing (likely a filter change or query addition in the server action / data fetch)
- Reuse all existing UI components (`ReviewQueueClient`, `ReviewActions`, `BulkReviewBar`)
- Add a "lifecycle state" column if the table doesn't already surface it

**Operator-web boundary:** per root CLAUDE.md, operator-web stays read-only. The CC review page already writes via `apps/api` — this pattern is correct and must be preserved.

### 5.3 Schema

- `pick_reviews` table exists — migration `202603200018_pick_reviews.sql`
- `PickReviewDecision` type exported from `@unit-talk/db`
- `ApprovalStatus` type exported from `@unit-talk/db`

**No schema work required in UTV2-493.** The storage layer is already there.

---

## 6. Queueing path audit (for UTV2-492 / P7A-02)

### 6.1 Every call site that transitions picks to `queued` or enqueues distribution

Grep result for `enqueueDistributionAtomic|enqueueDistribution|ensurePickLifecycleState.*queued|transitionPickLifecycle.*queued`:

1. `apps/api/src/controllers/submit-pick-controller.ts:40-67` — auto-enqueue at submission time when `promotionStatus === 'qualified' && promotionTarget != null`
2. `apps/api/src/run-audit-service.ts:31-174` — `enqueueDistributionWithRunTracking` is the primary wrapper; called by submit-pick-controller AND by operator paths
3. `apps/api/src/distribution-service.ts` — `enqueueDistributionWork` (sequential path), target validation, rollout gate
4. `apps/api/src/controllers/requeue-controller.ts` — **operator manual re-queue endpoint** — **not in the UTV2-492 scope as written** but probably should be
5. `apps/api/src/scripts/proof-force-promote.ts` — proof script, not prod
6. Tests: `submission-service.test.ts`, `distribution-service.test.ts`, `http-integration.test.ts`, `golden-regression.test.ts`, `grading-service.test.ts`, `server.test.ts`

### 6.2 The atomic path

**File:** `apps/api/src/run-audit-service.ts:69-96`

The atomic path calls `outboxRepository.enqueueDistributionAtomic({fromState, toState: 'queued', ...})` which is a Postgres RPC (`202604010002_enqueue_atomicity_rpc.sql`). This RPC does lifecycle transition + outbox insert in a single transaction. **The FSM check in `packages/db/src/lifecycle.ts` does not run on this path** — the RPC goes direct to SQL.

**Implication for UTV2-491 (P7A-01):** Adding `awaiting_approval` to the TypeScript FSM in `lifecycle.ts` is necessary but not sufficient. The `picks.status` check constraint in Postgres must also be updated (already in UTV2-491 scope: "add the DB migration for picks.status check constraint in the next migration slot"). AND the atomic enqueue RPC must be reconciled to refuse `fromState === 'awaiting_approval'` OR the caller must gate on state before calling the RPC.

**Implication for UTV2-492 (P7A-02):** The brake cannot rely solely on the FSM. It must either:
- (a) Check `pick.lifecycleState === 'awaiting_approval'` BEFORE calling `enqueueDistributionWithRunTracking` in submit-pick-controller.ts:40 — gates the happy path, or
- (b) Add an early-return guard inside `enqueueDistributionWithRunTracking` at the top — gates both submit-pick-controller and requeue-controller callers, or
- (c) Update `enqueueDistributionAtomic` RPC to refuse `fromState === 'awaiting_approval'` — gates the atomic path but not the sequential fallback without additional work, or
- (d) All of the above (belt + suspenders)

UTV2-492's acceptance criteria already flag this: "the brake applies to the real queueing path, not just distribution-service.ts". This ratification confirms UTV2-492's scope is correct.

### 6.3 Review-controller indirect path

**File:** `apps/api/src/controllers/review-pick-controller.ts:101-111`

On `approve` decision, the review controller calls `evaluateAllPoliciesEagerAndPersist` which can cascade into promotion status changes. If the pick then becomes `qualified`, the next submission or manual re-queue would enqueue it. **This is not a new auto-enqueue path** — it is a re-evaluation of an already-approved pick, which is the desired behavior for UTV2-493.

**Finding:** No change needed to the review controller to prevent an auto-enqueue bypass — it does not call `enqueueDistributionWithRunTracking` directly. The enqueue happens later, through the normal path, which UTV2-492 will already be gating.

### 6.4 Requeue controller (NOT in UTV2-492 scope — flagging for attention)

**File:** `apps/api/src/controllers/requeue-controller.ts`

This is an operator endpoint for manually re-queueing a pick. It calls the same `enqueueDistributionWithRunTracking` wrapper. **If UTV2-492 gates the brake inside that wrapper, this controller is automatically covered.** If UTV2-492 instead gates only inside `submit-pick-controller.ts`, this controller is a bypass path.

**Recommendation:** UTV2-492 should place the brake inside `enqueueDistributionWithRunTracking` (option b in §6.2) so both submit and requeue callers are covered. This should be made explicit in the UTV2-492 implementation PR, or added to the issue description before execution.

---

## 7. Migration head + collision risk

### 7.1 Migration head

Head migration on disk and in `schema_migrations` (assumed to match per 2026-04-08 repair): `202604100002_utv2_480_market_family_trust.sql`.

**Next free slot for Phase 7A:** `202604100003_` (same day) or `202604110001_` (tomorrow).

UTV2-491's description says "Add/adjust the DB migration for picks.status check constraint in the next migration slot" — this ratification confirms the slot exists and is uncontested.

### 7.2 Collision risk check

**Recent commits on lifecycle spine** (`packages/db/src/lifecycle.ts`, `packages/contracts/src/picks.ts`, `apps/api/src/distribution-service.ts`, `apps/api/src/promotion-service.ts`, `apps/api/src/controllers/submit-pick-controller.ts`, `apps/api/src/run-audit-service.ts`, `apps/api/src/controllers/review-pick-controller.ts`):

Since 2026-04-08 (last 2 days): **zero commits**.

Most recent commit touching any of those files: `66c9cc1 fix(phase1): CFix-1/2/3 — scanner source enum, market alias expansion, CLV wiring` — Phase 1 closure, ancient.

**Working tree on main:** clean (only the untracked `docs/06_status/PHASE7_PLAN_DRAFT.md` from this session).

**Remote branches:** 100+ stale feat/ and codex/ branches from prior sprints still exist but none tracking the lifecycle spine. No open PRs on main touching these files (not independently verified via `gh pr list` in this session — recommended as a final pre-merge check before UTV2-491 dispatches).

**Local worktrees:** 27+ `.claude/worktrees/agent-*` directories exist containing isolated copies of the codebase from prior agent sessions. These are not collision risk (worktrees are isolated by definition) but are noise. Cleaning them up is **out of scope** for ratification.

**Verdict on collision risk:** No collision risk detected on the lifecycle spine as of HEAD `154f27a`. Phase 7A is free to dispatch.

---

## 8. Assumptions carried forward from the plan draft (to be tracked)

The plan draft lists assumptions A1-A5. Ratified status:

| # | Assumption | Ratification status |
|---|---|---|
| A1 | Goal is to get to a real syndicate-grade machine, not to preserve current distribution cadence. Phase 7A pauses autonomous distribution. | **CONFIRMED** — PM must sign off on this. The only autonomous producer currently live is alert-agent; pausing it means alert-generated picks will wait for human approval, not auto-post. |
| A2 | PM has capacity to act as approval authority during the transition. | **NEEDS PM CONFIRMATION** — if alert-agent volume exceeds PM bandwidth, staffing the CC review queue is a precondition to merging UTV2-491. |
| A3 | system-pick-scanner and alert-agent can be feature-gated off without business impact. | **PARTIAL** — system-pick-scanner is already OFF in repo default so no business impact there. alert-agent is ON by default. Turning it off drops a live signal — PM must decide whether to turn it off during the 7A→7B window or leave it on and accept that alert picks back up in the review queue. |
| A4 | ModelRegistryRepository is production-quality and only needs a wiring pass in 7D. | **DEFERRED** — not re-verified in this ratification (out of scope for 7R). Must be verified before UTV2-503 (P7D-01) moves to Ready. |
| A5 | Supabase Micro compute tier is sufficient for 7A/B proof runs. | **DEFERRED** — last known tier change was NANO→Micro during Phase 5 proof. Phase 7A proof should fit but may push. Not blocking ratification. |

---

## 9. Open verification items (NOT blocking ratification)

These are deferred to the issues that will actually need them, not to ratification:

1. Production env state for `SYSTEM_PICK_SCANNER_ENABLED`, `SYNDICATE_MACHINE_ENABLED`, `ALERT_AGENT_ENABLED` — Ops to confirm. Repo defaults recorded in §4.
2. `gh pr list` to confirm no open PR touching the lifecycle spine — should be run immediately before UTV2-491 dispatch.
3. Trace of `promotion-service.ts` internal enqueue paths (if any direct `enqueueDistributionAtomic` calls bypass `enqueueDistributionWithRunTracking`) — UTV2-492 will own this verification within its own scope.
4. CC review page server-action query: confirm it filters by `approval_status === 'pending'` (so UTV2-493 knows whether to extend the filter to also include `lifecycle_state === 'awaiting_approval'` or whether the existing filter already catches it via `approval_status === 'pending'`).
5. `.claude/worktrees/*` cleanup — out of scope for 7R, flagged for a hygiene sprint.

---

## 10. Verdict

**Ratification:** PASS — with one doc edit (PROGRAM_STATUS.md line 80 positioning statement) applied in the same commit as this bundle.

**Gate status after ratification:** Phase 7A can start. Issues in order:

1. UTV2-491 (P7A-01 lifecycle + contract) — Ready
2. UTV2-492 (P7A-02 queueing gate) — blocked on 491
3. UTV2-493 (P7A-03 extend review flow) — blocked on 492
4. UTV2-494 (P7A-99 proof bundle) — blocked on all 7A children

Linear state transitions (to be applied by PM or on PM approval):

- UTV2-485 → Done (this bundle accepted)
- UTV2-491 → Ready (gate opens)
- 492/493/494 stay Backlog until their upstream dependency closes

**Hard constraints the execution must respect:**

- No merging UTV2-491 and UTV2-492 in the same deploy window (migration serialization)
- No turning on `SYSTEM_PICK_SCANNER_ENABLED` or `SYNDICATE_MACHINE_ENABLED` in prod during the 7A transition
- `ALERT_AGENT_ENABLED` can stay on; alert picks will land in `awaiting_approval` after 491+492 merge
- UTV2-492 must place the brake inside `enqueueDistributionWithRunTracking` (not solely in distribution-service.ts or submit-pick-controller.ts) to cover the requeue bypass path identified in §6.4

---

## 11. Honest uncertainty list (things I did not verify in this pass)

1. Production env values for the three feature flags. Only repo defaults recorded.
2. `gh pr list` output. Not executed — no live remote PR verification.
3. `ModelRegistryRepository` production-readiness (A4). Deferred to 7D.
4. CC review page server-action exact query filter. Flagged for UTV2-493.
5. Full trace of `promotion-service.ts` internal enqueue paths. Flagged for UTV2-492.
6. Live Supabase state of the `picks_status_check` constraint text. UTV2-491's migration will drop + recreate, so the current text is not load-bearing for the migration, but if the current text is divergent from what's committed in the migration history, that's a repair-needed scenario.
7. Whether any of the 27 `.claude/worktrees/agent-*` directories contain uncommitted work that should be rescued before cleanup. Out of scope.
8. Whether UTV2-493's CC review page extension needs server-side rendering changes in `apps/operator-web` or only in `apps/command-center`. The review flow in §5.2 appears to be fully in command-center, but operator-web may also have a read-only listing that needs refreshing.

**None of these items block ratification.** They are all either scoped to a specific Phase 7 issue that will own the verification, or out of scope entirely.

---

**End of ratification bundle. Awaiting PM acceptance.**
