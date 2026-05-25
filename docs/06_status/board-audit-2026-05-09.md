# Board Audit — System Wire / unit-talk-v2
**Date:** 2026-05-09  
**Auditor:** Claude Code (PM instruction)  
**Scope:** All non-Done, non-Canceled workflow states in the unit-talk-v2 Linear workspace  
**Action:** Read-only. No issue state was modified.

---

## Executive Summary

| Finding Category | Count |
|---|---|
| Ready to Close — pending Done transition | 3 |
| Blocked Internal — legitimately active | 2 |
| Blocked Internal — stale / wrong state | 3 |
| Needs Standard — superseded or absorbed | 2 |
| Needs Standard — valid backlog, needs triage | 2 |
| Backlog — new, needs tier label + assignee | 1 |
| In Claude — long-running umbrella (appropriate) | 1 |
| **Total issues flagged** | **14** |

---

## Section 1: Ready to Close — Pending Done Transition

Three issues carry PM Decision "Approved / ready to close" in their descriptions but remain at **Ready to Close**, not Done. Each requires `ops:truth-check` + `ops:lane-close` before moving.

### UTV2-860 — Reconcile D3 live schema gap from Phase 9
- **Priority:** Urgent (T1)
- **Current state:** Ready to Close
- **Recommendation: Done**
- Proof artifact present: `docs/06_status/proof/UTV2-860-phase9-ledger-reconciliation.json`. PM approved. Pending lane close only.

### UTV2-861 — Apply low-risk schema convergence slice
- **Priority:** Urgent (T1)
- **Current state:** Ready to Close
- **Recommendation: Done**
- Proof artifact present: `docs/06_status/proof/UTV2-861-low-risk-convergence-verification.json`. PM approved. Pending lane close only.

### UTV2-865 — DB migration drift CI gate
- **Priority:** High (T2)
- **Current state:** Ready to Close
- **Recommendation: Done**
- Implementation shipped in `scripts/ci/` (schema-drift-gate, live-schema-parity-workflow). PM approved. Pending lane close only.

**Action required (PM):** Run `ops:truth-check` on each, then `ops:lane-close`. All three can be closed in one session.

---

## Section 2: Blocked Internal — Active and Legitimate

These blocks are recent, well-scoped, and should remain Blocked Internal.

### UTV2-863 — Apply model ownership schema live after prerequisite convergence
- **Priority:** Urgent (T1) | **Created:** 2026-05-08 | **Updated:** 2026-05-09
- **Recommendation: Active — retain Blocked Internal**
- Schema columns are live; the scoring service write path (`CandidateScoringService → pick_candidates`) does not yet persist `model_registry_id`, `scoring_run_id`, or `ownership_timestamp`. Block is engineering-defined, recent, and in-flight.

### UTV2-864 — First legitimate model-attributed candidate proof
- **Priority:** Urgent (T1) | **Created:** 2026-05-08
- **Recommendation: Active — retain Blocked Internal**
- Downstream of UTV2-863. Will unblock when scoring service writes ownership metadata. Appropriate dependency hold.

---

## Section 3: Blocked Internal — Stale State (State Correction Needed)

### UTV2-780 — Confirm EX44 setup fee and purchase prerequisites
- **Priority:** Urgent (T1) | **Created:** 2026-04-28 | **Last updated:** 2026-05-04
- **Recommendation: Move to Needs PM Decision**
- 5 of 6 ACs are checked. The only remaining AC is: "Final purchase/no-purchase decision recorded by PM" (unchecked). The label `needs:pm-decision` already signals the correct state. "Blocked Internal" implies an engineering block; this is a PM decision gate. Additionally, the blocking relation to UTV2-786 is stale — UTV2-786 is Done. Correct state: **Needs PM Decision**.

### UTV2-652 — Wire provider execution quality into routing and trust
- **Priority:** Medium (T2) | **Created:** 2026-04-16 | **Last updated:** 2026-05-09 (cycle touch, no material change)
- **Recommendation: Deferred**
- Block condition in description: *"Blocked by data volume, not code. Do not start until there is sufficient data."* This is a data maturity gate, not an engineering block. Twenty-three days with no progress, no engineering action available. Move to **Deferred** and add a re-entry condition (e.g., minimum N provider-quality rows in production).

### UTV2-433 — MP-M3: MLB live production-readiness gate
- **Priority:** High (T2) | **Created:** 2026-04-07 | **Last updated:** 2026-05-04
- **Recommendation: Retain Blocked Internal — annotate expected unblock path**
- Gate FAIL: 3/167 CLV-backed outcomes (1.8% vs 10% threshold). Root cause is Pick Provenance Gap — MLBpicks lacked provenance linkage for CLV. The provenance infrastructure stack (UTV2-847–850) is now Done. UTV2-863 (ownership persistence) is in-flight. This gate may unblock once scoring writes ownership and provenance linkage propagates to settled outcomes. PM should annotate the expected unblock dependency (`UTV2-863 → re-run gate`) so the stall period is explained. Do not defer — the gate itself is valid and the dependency is resolving.

---

## Section 4: Needs Standard — Superseded or Absorbed

### UTV2-853 — Persist model ownership at candidate scoring
- **Created:** 2026-05-07 | **Last updated:** 2026-05-07 | **No activity since creation**
- **Recommendation: Done (planning pass complete) — or Superseded by UTV2-863**
- The issue description explicitly states: *"UTV2-853 planning pass identified the exact runtime insertion point."* The execution was forked into UTV2-863, which is now the active implementation lane. UTV2-853 was a planning/spec artifact, not an implementation lane. Holding it at Needs Standard creates false queue depth and will confuse future sprints. Close as **Done** (planning complete, execution forked) or mark **Superseded** by UTV2-863.

### UTV2-852 — Build schema drift detection and PostgREST cache integrity health checks
- **Created:** 2026-05-07 | **Last updated:** 2026-05-07
- **Recommendation: Backlog (scope-narrowed to PostgREST cache only)**
- The schema drift detection portion of this issue has been absorbed:
  - UTV2-865 (Ready to Close) — migration drift CI gate
  - UTV2-857 (Done) — continuous live schema parity verification
- The remaining unaddressed scope is **PostgREST cache integrity health checks** specifically. Do not close — but the title and scope should be narrowed before execution. Move to Backlog; update title/description to reflect remaining scope only.

---

## Section 5: Needs Standard — Valid Backlog, Needs Triage

### UTV2-851 — Quarantine unsupported and low-trust markets from edge analytics
- **Priority:** Urgent (T1) | **Created:** 2026-05-07 | **No movement**
- **Recommendation: Backlog**
- Valid, well-scoped problem: contamination of edge analytics by unsupported/alias-heavy/malformed/low-trust market rows. Not superseded. No standard (implementation spec) has been written yet. Move to **Backlog**; defer execution until UTV2-863 ownership persistence stabilizes and candidate materialization is clean.

### UTV2-855 — DB truth / schema discipline / Supabase reconciliation umbrella
- **Priority:** Urgent (T1) | **Created:** 2026-05-08
- **Recommendation: Move to Backlog (active umbrella)**
- UTV2-855 is the parent umbrella for 13 child issues. 8 children are Done, 3 are Ready to Close, 2 are Blocked Internal, 1 is Backlog. The umbrella sitting at Needs Standard while active children are executing is misleading. Move to **Backlog** to accurately reflect its role as an open tracking container. Umbrella can move to Done only after all children close.

---

## Section 6: Backlog — Needs Triage

### UTV2-868 — Investigate ghost migration 202604300003 — historical integrity uncertainty
- **Priority:** High | **Created:** 2026-05-09 (today)
- **Recommendation: Backlog — add tier label + assignee**
- New issue surfaced during UTV2-862 audit. Migration `202604300003` appears in remote Supabase ledger with no local file counterpart. PM classified as historical integrity uncertainty, not a nuisance. Currently has no tier label and no assignee. Needs both before next sprint cycle. Suggested tier: T2.

---

## Section 7: In Claude — Long-Running Umbrella (Appropriate)

### UTV2-770 — Hetzner self-hosted cutover gate
- **Priority:** Urgent (T1) | **Started:** 2026-05-03
- **Recommendation: Active — no state change**
- Parent umbrella tracking the ingestion freshness gate requirement before production cutover. Child UTV2-780 is pending a PM purchase decision. In Claude state is appropriate while planning and decision work continues. PM should resolve the UTV2-780 purchase decision to unblock downstream provisioning.

---

## UTV2-855 Umbrella Child Map

| Issue | Title | State | Audit Recommendation |
|---|---|---|---|
| UTV2-856 | Establish authoritative DB migration workflow | Done ✅ | — |
| UTV2-857 | Continuous live schema parity verification | Done ✅ | — |
| UTV2-858 | Define environment model and DB operator policy | Done ✅ | — |
| UTV2-859 | Build read-only DB inspection toolkit | Done ✅ | — |
| UTV2-860 | Reconcile D3 live schema gap | Ready to Close | → **Done** |
| UTV2-861 | Apply low-risk schema convergence slice | Ready to Close | → **Done** |
| UTV2-862 | Review provider-history migration slice | Done ✅ | — |
| UTV2-863 | Apply model ownership schema live | Blocked Internal | Active (retain) |
| UTV2-864 | First model-attributed candidate proof | Blocked Internal | Active (wait on 863) |
| UTV2-865 | DB migration drift CI gate | Ready to Close | → **Done** |
| UTV2-866 | DB rollback and forward-fix runbook | Done ✅ | — |
| UTV2-867 | Supabase cost and branch governance policy | Done ✅ | — |
| UTV2-868 | Investigate ghost migration 202604300003 | Backlog | Add tier + assignee |

---

## Full Recommendation Table

| Issue | Title | Current State | Recommended State | Justification |
|---|---|---|---|---|
| UTV2-860 | Reconcile D3 live schema gap | Ready to Close | **Done** | PM approved, proof exists, lane close only |
| UTV2-861 | Apply low-risk schema convergence slice | Ready to Close | **Done** | PM approved, proof exists, lane close only |
| UTV2-865 | DB migration drift CI gate | Ready to Close | **Done** | PM approved, CI gate shipped, lane close only |
| UTV2-863 | Apply model ownership schema live | Blocked Internal | **Active** | Legitimate engineering block, recently placed |
| UTV2-864 | First model-attributed candidate proof | Blocked Internal | **Active** | Downstream of UTV2-863, appropriate hold |
| UTV2-780 | Confirm EX44 setup fee and prerequisites | Blocked Internal | **Needs PM Decision** | Only unchecked AC is a PM decision; not an engineering block |
| UTV2-652 | Wire provider execution quality into routing | Blocked Internal | **Deferred** | Data-volume gate, not code; 23-day stall, no engineering action available |
| UTV2-433 | MLB live production-readiness gate | Blocked Internal | **Blocked Internal** (annotate) | Gate valid; annotate UTV2-863 as unblock dependency |
| UTV2-853 | Persist model ownership at candidate scoring | Needs Standard | **Done** or **Superseded** | Planning pass complete; execution forked to UTV2-863 |
| UTV2-852 | Schema drift detection + PostgREST health | Needs Standard | **Backlog** (scope-narrow) | Drift portion absorbed by UTV2-857+865; PostgREST cache scope remains |
| UTV2-851 | Quarantine unsupported markets from analytics | Needs Standard | **Backlog** | Valid scope, not superseded; defer until UTV2-863 stabilizes |
| UTV2-855 | DB truth / schema umbrella | Needs Standard | **Backlog** | Active umbrella with open children; Needs Standard is misleading |
| UTV2-868 | Investigate ghost migration 202604300003 | Backlog | **Backlog** (add tier + assignee) | New today; assign and tier before next sprint |
| UTV2-770 | Hetzner self-hosted cutover gate | In Claude | **Active** | Appropriate umbrella state; PM to resolve UTV2-780 decision |

---

## Priority Actions for PM

1. **Run `ops:truth-check` + `ops:lane-close` on UTV2-860, UTV2-861, UTV2-865.** These are already approved and blocking clean sprint accounting.
2. **Record purchase/no-purchase decision on UTV2-780 and move to Needs PM Decision.** The EX44 research is complete; only the decision remains.
3. **Close or supersede UTV2-853.** It is a planning artifact, not an execution lane. Keeping it at Needs Standard will cause confusion next sprint.
4. **Move UTV2-652 to Deferred** with an explicit re-entry condition written into the description.
5. **Annotate UTV2-433** with the expected unblock path (UTV2-863 close → re-run CLV gate).
6. **Add tier label + assignee to UTV2-868** before next sprint cycle.
7. **Move UTV2-855 to Backlog** to reflect its role as an active umbrella.
