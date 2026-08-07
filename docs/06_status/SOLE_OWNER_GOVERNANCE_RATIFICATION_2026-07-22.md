# Sole-Owner Governance — Ratification (2026-07-22)

Status: **PM-ratified decisions.** Authored by Claude (orchestrator) at griff843's direct chat instruction,
recording his ruling on `SOLE_OWNER_GOVERNANCE_CONVERGENCE_PROPOSAL.md` §7 ("Griff decisions"). This document
is the binding decision record; the convergence proposal remains the analysis it was ratified from and is not
itself authoritative once this document exists for a given row.

This document **amends** `docs/06_status/T1M_DELEGATION_FINAL_PM_DECISION.md` per the convergence proposal's
§8 supersession plan. It does not rewrite or replace that document — where this ratification is silent, the
Final PM Decision continues to govern.

---

## 1. Ratified decisions (convergence proposal §7, rows 1–7 and 9)

Each row below is ratified as its "Converged rec." exactly as written in
`SOLE_OWNER_GOVERNANCE_CONVERGENCE_PROPOSAL.md` §7:

| # | Question | Ratified decision |
|---|---|---|
| 1 | Delete/simplify first, or build+shadow+certify first? | **Build → shadow → ratify → cutover → delete**, in that order (Codex's sequencing). No authorization control is removed before its replacement is shadow-certified. Non-authorizing noise may still be demoted to advisory immediately. |
| 2 | What artifact replaces `pm-verdict/v1` comments/`t1-approved` labels as the human-authority signal? | A **GitHub environment/attestation service, Griff-controlled only**, built in PR3, activated only in PR5. Comments/labels remain the interim authority signal until then. |
| 3 | May the orchestrator delete/disable existing checks under standing authority, or is each deletion a Griff decision? | **Each deletion is a Griff decision.** No standing authority. Deletions happen only inside PR1–5, each under the existing Griff-only T1-H gate. |
| 4 | Disable `strict: true` now, or pilot first? | **Retain `strict: true` through the pilot.** Revisit only with measured pilot evidence. |
| 5 | Does T1-M/R (mechanical reconciliation) need a standing independent-reviewer seat during the pilot? | **Yes, through pilot certification.** Griff may drop it for T1-M/R specifically once ≥10 clean R-lanes show zero reviewer catches. |
| 6 | Is the T1-M signed-attestation/ledger substrate (UTV2-1555/UTV2-1556) still authorized now, or deferred? | **Authorized now, in shadow only** (PR2–3 of the five-PR migration). No live authority until PR5's Griff ratification. UTV2-1555/1556 proceed per their existing blocked-by list, re-sequenced behind PR1. |
| 7 | Approve moving post-merge state to an external append-only closeout record, eliminating tracked SHA-rebind/terminal-close PRs? | **Yes.** Ships in PR4. `files_changed` stays immutable historical evidence; never re-derived or re-litigated post-merge. |
| 9 | Who may restore the kill switch after it fires? | **Griff only.** No orchestrator self-restoration under any circumstance, including "clean diagnosis." |

## 2. Deferred (not ratified today)

**Row 8** — "What annualized probability of a bad merge reaching production is acceptable?" — has no proposed
value in the convergence proposal; it is a request for a number from Griff, not a recommendation to accept or
reject. **Explicitly deferred.** Per §9 of the convergence proposal, this row is not required to begin PR1 (only
rows 1–4 and 9 are); it is required before **PR5's cutover** can merge. Until supplied, PR5's FP-rate/reviewer-
count thresholds remain the heuristic values already stated in convergence proposal §6 (≤5% FP, ≥80% seeded
catch rate, ≥95% shadow-vs-live agreement) rather than derived from a stated risk tolerance.

## 3. What this ratification authorizes

Per convergence proposal §9: "Implementation (PR1) can begin once Griff rules on rows 1–4 and 9." Those five
rows are ratified above. **PR1 of the five-PR migration (convergence proposal §5) is authorized to begin.**

PR5's cutover explicitly requires, and does not yet have: shadow-pilot thresholds met (§6 of the convergence
proposal) **and** row 8's number **and** Griff's explicit written ratification of each row at that time — this
document ratifies the rows as scoped today; it is not a standing pre-authorization for PR5 itself, which the
convergence proposal (§7 row 3, ratified above) requires as its own separate Griff decision when it comes up
for cutover.

## 4. Supersession (unchanged from convergence proposal §8)

Everything in `SOLE_OWNER_GOVERNANCE_CONVERGENCE_PROPOSAL.md` §8 ("Supersession plan") is ratified as written
and incorporated here by reference — no changes. Notably: `T1M_DELEGATION_FINAL_PM_DECISION.md` is retained as
base architecture and amended, not replaced; `Executor Result Preflight` is closed as unnecessary now,
independent of the five-PR wave; `Readiness Regression Gate`/`Return Review Packet`/`Tier Label Check` are
amended to advisory/on-demand now (severity demotion only); file-scope lock excluding `merged`/`done` is
already shipped (PR #1291) and closed, no further action.

---

**Ratified by:** griff843 (PM), via direct chat instruction, 2026-07-22.
**Recorded by:** Claude (orchestrator), as this governed PR.
