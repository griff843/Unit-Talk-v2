# Operating Model — Sonnet 5 Era

**Authority:** Claude/governance-owned. Changes require PM review.
**Produced by:** UTV2-1390 (2026-07-01), following adversarial review of a proposed operating-model change and PM decisions on scope.
**Depends on:** `docs/05_operations/agent-role-contracts.md`, `docs/governance/AGENT_SKILL_CONTRACTS.md`, `.claude/commands/three-brain.md`, `.claude/commands/dispatch.md`.

---

## Purpose

This document is the canonical source for the Sonnet-5-era operating model: what Claude decides unilaterally, what still requires a PM gate, what an Outcome Contract is and is not, and how runtime validation scales by tier. It exists because a chat-proposed version of this model was adversarially reviewed and found to narrow the PM-gate trigger list relative to `three-brain.md` Rule 9 — an oversight that would have silently widened agent autonomy if adopted without a real diff. See [[feedback-governance-changes-require-pr-not-chat]] (session memory) for the precedent this document sets: governance changes land as a reviewable PR, never purely from a chat directive.

**Cutover:** This model applies only to lanes opened after this document (and the accompanying diffs to `three-brain.md`, `dispatch.md`, `agent-role-contracts.md`, `AGENT_SKILL_CONTRACTS.md`, `contract-validator.ts`) merge to main via `UTV2-WORKFLOW-RESET`. It does not retroactively apply to lanes already open at merge time. Existing governance (current CLAUDE.md invariants, current `three-brain.md` Rule 9, current lane/proof mechanics) remains binding until then.

---

## 1. Roles

- **PM (Griff):** defines outcome, constraints, forbidden actions, proof requirements, and gates. Reviews artifacts (Outcome Contracts, proof bundles, diffs) — not narrative summaries.
- **Claude (Sonnet 5):** owns diagnosis, implementation strategy, lane decomposition, preflight, and dispatch recommendations. Orchestrates; does not self-certify Done.
- **Codex:** implements scoped code lanes, constrained by the existing T1/Tier C rules in `three-brain.md` (Rule 1, Rule 2 remain absolute — Codex never touches `packages/domain/`, `packages/contracts/`, migrations, lifecycle, or auth, regardless of tier). Which concrete Codex model and reasoning effort execute a lane is a separate, deterministic decision (`three-brain.md`'s Codex model-profile routing table, canonical policy `docs/05_operations/policies/codex-model-routing.json`) — it selects execution strength only and never changes the tier/scope/merge gates in this document.
- **Opus 4.8:** reserved for Tier C / adversarial review only (Codex-diff critique on Tier C paths, per `three-brain.md`'s existing Codex-critique-model table). Not used for routine T1 planning.
- **Fable 5 (UTV2-1568 — BOUNDED PILOT, not permanent reinstatement):** a time- and count-boxed evaluation of Fable 5 as an *advisory* reviewer for a narrow class of decisions, run before any permanent routing change is considered. This is explicitly **not** the permanent reinstatement UTV2-1390 removed — see the pilot terms below for exactly what is and is not authorized during the pilot window.

  **Evidence behind opening the pilot:** a neutral, comparative round (5 controlled Unit-Talk-specific tasks, Fable vs. the Sonnet-5 baseline, run 2026-07-21) found Fable materially stronger on judgment-heavy synthesis and live-verification-driven root-cause work — not merely more verbose — and roughly tied with Sonnet elsewhere. It did not support broad or default use. Full comparison record: session evidence attached to this PR; a condensed version belongs in `docs/06_status/proof/UTV2-1568/`.

  **Pilot terms (binding for the pilot window only):**
  - **Scope:** advisory review only, for at most three narrow trigger classes — (a) a lane has bounced CHANGES_REQUIRED more than once on the same architectural question, (b) a product-synthesis decision has no existing precedent to follow, or (c) a hard root-cause/mechanistic-verification task where live-state evidence must be checked, not just reasoned about (the class Task 3 of the comparison evidenced). Genuinely novel-architecture or constitutional-scope T1 work remains excluded and stays a Rule 9 Griff-escalation trigger, exactly as under UTV2-1390.
  - **Advisory only, no binding vote:** a Fable review is input to Griff's decision or to Codex/Claude's own revision — it is never itself a merge authority, never a `pm-verdict/v1` substitute, and **never counts as a vote in any T1-M quorum**, machine or otherwise. Nothing Fable produces during the pilot authorizes a merge by itself.
  - **Does not replace Rule 9 or Griff's T1-H authority:** every existing Rule 9 trigger fires exactly as before. Authority-touching changes (to this document, `three-brain.md`, the not-yet-built T1-M/T1-H classifier (UTV2-1555), or delegation policy) are unconditionally Rule 9 regardless of what Fable concludes about them — a quality gate a proposal must pass *before* reaching Griff, never a substitute for Griff's sign-off.
  - **Reviewer independence:** Fable never reviews its own proposal, and never reviews a framing curated by the identity that authored the change — it receives the artifact as it stands (e.g. `git diff main`), not an author-selected summary. The authoring identity is never the certifying identity.
  - **Duration/volume cap:** the pilot ends at **8 qualifying real tasks or 30 calendar days from activation, whichever comes first.** A "qualifying task" is a real (non-synthetic) invocation under one of the three trigger classes above, logged with issue/PR/head SHA. Once either limit is hit, Fable routing reverts to Rule 9-only (the pre-pilot UTV2-1390 state) automatically, pending the permanent decision below — it does not silently continue.
  - **Usage budget:** Fable is Anthropic's highest-capability, highest-cost tier (~4-5x Sonnet 5 per-token pricing per the pilot's own grounding research). Cap pilot spend at a fixed ceiling set at activation (recorded in the pilot's tracking issue) and stop early if exceeded, even if the 8-task/30-day limit hasn't been reached.
  - **Metrics tracked per qualifying task:** which trigger class fired, whether Fable's finding was independently confirmed as materially correct (not just plausible), whether it found something the standard reviewer path missed, cost, and whether it introduced any owner-facing question that wasn't necessary.
  - **Rollback:** at any point, reverting to Rule 9-only requires nothing more than reverting this document's Fable entry and the corresponding `three-brain.md` row — no other system depends on Fable's availability, and no in-flight decision is left in an ambiguous state (advisory-only means there is never a pending binding action to unwind).
  - **Final permanent gate:** at pilot end (either limit), a decision packet (FABLE 5 PERMANENT INTEGRATION: YES / NO / EXTEND) goes to Griff with the accumulated metrics. Permanent reinstatement, if any, requires its own fresh governance-change diff and adversarial review — it does not happen automatically just because the pilot ran to completion.

  **What UTV2-1390 actually removed, and why the pilot isn't the same thing:** UTV2-1390 was a consolidation decision, not a response to a specific Fable failure — the PM decision record states plainly that Sonnet 5 would absorb "what Fable 5 previously covered for novel/constitutional scope," with ambiguous cases escalating directly to Griff instead of routing to a different model. This pilot does not undo that consolidation; it tests, on a hard time/count/spend budget with zero binding authority, whether a narrower slice of that prior role is worth reinstating permanently — a question UTV2-1390 itself did not have comparative evidence to answer either way.

  **Fallback:** if Fable is unavailable during the pilot (rate-limited, capability withdrawn) or once the pilot ends, the escalation falls back to Griff per Rule 9 — it never silently falls back to Claude or Codex self-certifying the same class of decision.

  **Mechanical enforcement status (honest, not yet built):** unlike Codex's model-profile routing (`docs/05_operations/policies/codex-model-routing.json` + `scripts/ops/model-routing.ts`, which validates profile selections and fails closed), Fable-routed decisions are not yet mechanically validated or count-capped in code — the 8-task/30-day/budget limits above are tracked manually (pilot tracking issue) until UTV2-1569 lands (extending the lane manifest's `model_routing` block with `reviewer_independent_of_author`, `fallback_used`, and pilot-counter fields, validated the same way Codex's profile selection is, and wired into `ops:truth-check`). Until UTV2-1569 lands, do not claim Fable-pilot compliance is machine-verified — it is not; it is currently enforced by discipline and this document, which is why the pilot's advisory-only/no-vote scope is deliberately conservative.

## 2. Outcome Contract — planning artifact only

For every new T1 lane, the planning subagent (Sonnet 5, per `three-brain.md`) produces an Outcome Contract before implementation begins:

- Issue
- Objective
- Why this matters
- Success criteria
- Forbidden actions
- Likely touched areas
- PM gates required
- Required proof
- Runtime validation
- Stop conditions
- Recommended executor

**The Outcome Contract does not replace:**
- The lane manifest (`docs/06_status/lanes/UTV2-###.json`)
- `file_scope_lock`
- `expected_proof_paths`
- R-level checks
- PM merge gates

It is a planning artifact posted to Linear for async PM review. The lane manifest, generated at `ops:lane-start` time, remains the sole mechanical authority for active lane state (CLAUDE.md invariant 6).

**Binding rule — divergence is an escalation trigger:** the Outcome Contract's "Likely touched areas" must generate-or-match the lane manifest's `file_scope_lock` at lane-start time, and "Required proof" must generate-or-match `expected_proof_paths`. If the actual diff at PR time touches files outside the declared scope, or proof artifacts diverge from what was declared, that divergence is itself a Rule 9 escalation trigger — file-scope divergence from the declared lane contract is explicitly listed in Rule 9. Do not silently widen the manifest's `file_scope_lock` and continue; stop and escalate, or narrow the diff back to the declared scope.

This rule exists because it was violated in practice: UTV2-1373's lane manifest declared `file_scope_lock` covering only 2 files, but the actual diff touched 5 (missing the two test files, `package.json`, and `verification.md`). This was caught by CI (Return review packet `scope` check), not by any pre-PR process — exactly the "CI discovers, doesn't confirm" failure mode this document exists to close.

## 3. PM gates — Rule 9 is authoritative, not narrowed

`three-brain.md` Rule 9 is the single, canonical, and unmodified list of always-escalate conditions. This document does not redefine, narrow, restate, or supersede it — see `three-brain.md` Rule 9 for the current list. (A prior version of this section duplicated the full list here; that copy has drifted out of sync before — e.g. it named "T2 merge (explicit PM approval)" as a mandatory gate after `merge-gate.yml` had already made orchestrator self-approval sufficient for T2. Restating it created a second source that could silently diverge from the one that's actually enforced. Read `three-brain.md` directly instead of trusting a copy.)

Note on merge authority specifically: T1 plan stage and T1 merge remain mandatory Rule 9 stop conditions. T2 merge is **not** — per `merge-gate.yml` (ratified 2026-05-18, UTV2-979) and Delegation Policy's Tier B model, the orchestrator diff-reviews and self-approves via `gh pr review --approve`; no PM presence or PM_VERDICT is mechanically required, for any executor.

**Do not ask PM to choose implementation details** unless one of the following applies: multiple valid architecture paths exist, the change involves a DB mutation/migration, public/member-facing delivery, settlement/CLV truth risk, governance-brake release, or Tier C implications. This narrows *routine implementation-detail* questions only — it does not narrow the Rule 9 escalation list above, which governs when to stop and involve PM regardless of implementation detail.

## 4. Local preflight — CI should confirm, not discover

The principle: by the time a PR opens, CI should be confirming what local preflight already established, not discovering gaps for the first time. Before opening a PR, run or simulate:

- Lane manifest exists and matches the issue
- Sync file (`.ops/sync/UTV2-###.yml`) exists and declares only this issue
- Expected proof paths exist
- `verification.md` has required sections (`## Verification` at minimum)
- Evidence rules match pre/post-merge state (branch-head SHA pre-merge, merge SHA post-merge — see the circular-SHA note below)
- File scope lock matches the actual diff (§2)
- R-level check passes
- Tier label expectation is known
- Runtime verifier expectation is known

**Status: not yet delivered as a single consolidated script in this lane.** `pnpm ops:preflight` and `pnpm ops:lane-close --explain` together cover most of these checks today, but at different lifecycle stages (pre-lane-start vs post-merge) and with at least one known internal tension (see below). Consolidating them into a single pre-PR command is a required follow-up, not delivered here — until it lands, "run or simulate" means manually running the closest existing tools (`pnpm ops:preflight`, a dry run of the proof-auditor-gate / runtime-verifier-gate scripts against the working proof dir) before opening a PR.

**Known tooling gap surfaced while implementing this lane:** `pnpm ops:preflight` requires a clean working tree (PG2) for T1, but also requires the T1 proof directory to already exist (PX5, non-waivable) with structurally valid content (PX3/PX4, non-waivable). For a brand-new T1 lane, these two requirements can only both be satisfied by committing proof-directory stub files (and any new canonical doc placeholders referenced in `file_scope_lock`) directly to `main` before running preflight — the same pattern already used for lane-registry files. This is a real gap in the preflight tool itself (not a lane-specific workaround); it is out of this lane's declared scope (`scripts/ops/preflight.ts` is not in `file_scope_lock`) and is called out here as a follow-up rather than silently patched.

**Circular SHA note:** `evidence.json`/`verification.md` are written pre-merge with the branch-head SHA (`sha_type: "branch_head"`) because the merge SHA does not exist yet. `ops:proof-generate --merge-sha` (run automatically by `post-merge-lane-close.yml`) regenerates `diff-summary.md`/`runtime-verification.md` with the real merge SHA but does **not** rewrite `evidence.json`/`verification.md` — those need a manual post-merge SHA rebind (`sha_type: "merge_sha"`) before `ops:lane-close`'s C4/P3 checks will pass. This is a known gap, not new to this lane (see UTV2-1373 proof).

## 5. Runtime validation by tier

- **T1:** required when runtime/product behavior is affected. Governance-only/doc-only T1 lanes (like this one) still run `pnpm test:db` per existing tier policy (CLAUDE.md verification table), but do not need to demonstrate the change itself against runtime data since there is no runtime change.
- **T2:** issue-specific / conditional. Not automatically required — apply when the issue description calls for it.
- **T3:** N/A unless the issue explicitly specifies runtime validation.

This does not change the existing CLAUDE.md verification table (T1 requires test:db + runtime proof; T2 requires type-check + test + issue-specific; T3 requires type-check + test). It clarifies that "runtime validation" as an Outcome Contract field should not be treated as a mandatory ceremony section for every lane regardless of tier — state "N/A" explicitly for T3, and issue-specific-or-N/A for T2, rather than filling it with boilerplate.

## 6. Production readiness — throughput over single-pick proof

For production-readiness work, proof should demonstrate pipeline throughput, not a single successful pick. Relevant stages: events scanned, offers ingested, fresh offers, candidates created, rejection counts by gate, qualified picks, promotion decisions, delivery path, grading/settlement, CLV/ROI population, fallback reasons.

Building a reliable throughput harness on "rejection counts by gate" / "fallback reasons" as inputs requires those fields to already be trustworthy. As of 2026-07-01, UTV2-1379 (domainAnalysis / confidence-delta fallback investigation) found that fallback-reason labeling is itself unreliable (92.4% of picks generically labeled `confidence-fallback` regardless of whether confidence was never submitted, no market data was found, or computation threw). A throughput harness that consumes this field before UTV2-1379 lands will produce a confidently wrong funnel report. Sequence accordingly: fix fallback-reason fidelity before or alongside building the throughput harness, not after.

## 7. Governance change protocol

Operating-model changes (PM-gate triggers, executor defaults, model routing) are proposed, adversarially reviewed, and — if accepted — committed as a real doc/code diff via a governance lane like this one, before they become binding. They do not take effect from a chat directive alone, even when PM-authored. See [[feedback-governance-changes-require-pr-not-chat]].

**Precedent applied (UTV2-1568):** the Fable 5 pilot in §1 above is being landed through this exact protocol, and was revised twice under it. Draft 1 (a permanent-reinstatement proposal) was sent to independent adversarial review and returned a BLOCK verdict with four material objections (a contradiction with the enforced routing source `three-brain.md`, an unenforced-in-practice evidence claim, undefined "BUILD MODE"/certification terms, and no acknowledgment of what UTV2-1390 actually removed); draft 2 addressed all four and passed adversarial review. Per direct PM instruction, draft 2's *permanent* framing was itself replaced with the current bounded-pilot framing (8 qualifying tasks or 30 days, advisory-only, no T1-M vote) before landing — permanent reinstatement is not being requested here at all; only the pilot is. It has not yet been re-reviewed against this final pilot framing or Griff-approved — landing still requires a real `pm-verdict/v1`, not this note.

## 8. BUILD MODE certification pilot

**BUILD MODE** is the operating state in which ordinary eligible T1/T2 work is planned, implemented, independently reviewed, merged, truth-closed, and cleaned up without routine Griff intervention — Griff is engaged only for a genuine T1-H owner decision (§3, Rule 9's mandatory gates), a separately-authorized production action, a material unresolved reviewer disagreement, or a security/authority anomaly. It is not a code flag or a runtime mode; it is a certification state this document defines and a specific pilot run either meets or does not.

A **certification pilot** is a bounded, real execution of eligible backlog work (not a simulation) whose outcome is reported against these criteria, all of which must hold for the pilot to certify BUILD MODE = YES:

- every implementation/repair carries a real merge SHA on `main` (not narrated as done pre-merge)
- zero active or non-terminal lanes at the end of the pilot window
- zero ghost lease/lock/manifest/worktree state
- the count of *routine* Griff approvals actually required during the pilot is reported honestly, including zero if that's what happened — and any genuine T1-H/production/disagreement/security escalation is reported as such, not folded into "routine"
- zero unauthorized actions (no self-issued PM verdicts, T1 approvals, or privileged scope authority; no weakened gates)
- zero stale approvals (a head change invalidates any approval bound to the prior head — enforced the same way `pm-verdict/v1`'s schema already requires for T1)
- reviewer independence held throughout (no identity certifying its own material work)
- model routing matched policy for every decision (Codex for implementation/mechanical review, Fable only for the narrow §1 pilot cases and only advisory, Claude for orchestration — no routine work spent on Fable, no Fable output treated as a binding vote or merge authority)
- Linear, GitHub, lane manifests, proof, leases, and locks agree at pilot end (CLAUDE.md truth hierarchy, rank 1–4)
- the pipeline continued into its next eligible unit of work without a fresh prompt, up to a real stop condition

A pilot that fails any one of these reports BUILD MODE CERTIFIED: NO along with which criterion failed and why — it does not round up.
