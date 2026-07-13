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
- **Fable 5:** removed from active routing. It is no longer a valid `model` value for any agent, skill, or planning subagent. Work that would previously have escalated to Fable 5 (novel architecture, constitutional scope, unresolved ambiguity) now escalates to Griff per Rule 9 (scope ambiguity / Tier C triggers) instead of routing to a different model.

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
