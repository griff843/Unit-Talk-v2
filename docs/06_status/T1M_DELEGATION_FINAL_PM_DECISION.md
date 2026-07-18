# T1-M / T1-H Delegation — Final PM Decision (Synthesis)

Status: PM-approved architecture, count-gated pilot, not yet implemented. Authored by Claude (orchestrator)
synthesizing `T1M_DELEGATION_DESIGN_PACKET.md` (Claude/Fable 5, Revision 2) and
`T1M_DELEGATION_CODEX_ADVERSARIAL_REVIEW.md` (Codex, verdict REVISE, accepted) per PM decision recorded
2026-07-18. This planning packet is tracked under **UTV2-1557** (dedicated decision-packet issue, docs-only,
same pattern as UTV2-1501); UTV2-1500 is the downstream canonical `DELEGATION_ACCOUNTABILITY_V1.md` contract
this packet feeds (see §18) and remains Blocked Internal — it is not the tracking issue for this PR.

This document is the binding synthesis. Where it conflicts with either source packet, **this document
wins**. Where it is silent, the Design Packet Revision 2 (which already incorporates the Codex reconciliation
in full — see its own "Revision 2 — Codex reconciliation" section) governs.

---

## 1. Architectural base

Claude's T1-M/T1-H operating architecture (Design Packet, Revision 2) is the base. Revision 2 already
supersedes Revision 1 wherever they conflict and already incorporates the Codex adversarial review's P0
findings verbatim (deterministic classifier, App-authored check-run verdicts, no PR-head code execution,
merge/deploy separation, bootstrap circularity resolved via the existing Griff-only gate). This document does
not re-litigate that reconciliation; it adds the PM's additional binding requirements below and resolves one
open tension between the two source packets (§12).

## 2. Codex P0/P1 findings are mandatory unless rebutted with exact repository evidence

Every P0 and P1 finding in `T1M_DELEGATION_CODEX_ADVERSARIAL_REVIEW.md` §2 is binding. None has been
rebutted. Implementation (UTV2-1555) must cite the exact repository evidence (file path + line, or workflow
name + job) for how each finding is closed; a finding may not be marked resolved by narrative claim alone.
All six Codex P0 findings — (1) approval forgery/replay, (2) no distinct identities today, (3) privileged
workflow self-modification, (4) T1-M not presently mechanically derivable, (5) merge/deploy authority not
separated, (6) bootstrap circularity — are accepted without exception (Design Packet R2.1).

### 2.1 Codex's fail-closed trust-transition ordering is mandatory, not advisory

Codex's 9-step bootstrap sequence (`T1M_DELEGATION_CODEX_ADVERSARIAL_REVIEW.md` §9, adopted into the Design
Packet as R2.4's intra-issue PR sequencing) is a **binding execution order, not a suggested one**. No PR in
the UTV2-1451 → UTV2-1546 → UTV2-1500 → UTV2-1555 chain may skip ahead of, merge out of order with, or
collapse a trust-transition step from that sequence — e.g., identity/App creation (step 3) may not precede
ratified taxonomy (step 1); shadow fan-out (step 5) may not precede environment hardening being scoped (step
6 may run in parallel with step 5 but neither may precede step 4's criteria-intake binding); the disabled
T1-M required check (step 7) may not be added to Merge Gate before charter/kill-state wiring exists to keep
it non-authorizing. Each step still merges individually under the existing Griff-only T1 gate (§17, §20);
"mandatory ordering" constrains *sequence*, not *authority* — authority is separately gated by §17/§20
regardless of sequence compliance.

## 3. T1-M/R vs T1-M/T are distinct subclasses

The Design Packet's single "T1-M" class is split into two subclasses with independent eligibility gates,
independent pilot lane counts (§11), and independent certification evidence (§11):

- **T1-M/R — mechanical reconciliation.** Manifest/proof/lease/lock repair, SHA rebinding, scope-lock
  completion, canonical-schema corrections, Linear/GitHub state reconciliation. No source code, no workflow
  files, no schema/contract changes. Reversible by `git revert` trivially — the changed content is bookkeeping,
  not behavior.
- **T1-M/T — reversible technical.** Source changes within the eligible path allowlist (Design Packet §2,
  Codex-amended: `packages/domain/**` excluded) that are `git revert`-clean, have acceptance criteria
  expressible as pre-existing CI checks, and touch no deny-listed path.

Both remain subject to every control in this document (quorum, classifier, veto, kill switch, staleness
invalidation). T1-M/R has a strictly narrower blast radius than T1-M/T and is expected to clear certification
first (§11).

**T1-M, in both subclasses, is a deny-by-default eligibility proof — not a broad T1 subclass.** A change is
T1-M only if the classifier affirmatively proves every conjunctive eligibility check in Design Packet §2
(Codex-amended); it is never T1-M by default, by omission, by absence of a matching deny rule, or by an
unrecognized path/file-kind (§12 below). The classifier's job is to prove eligibility, not to fail to prove
ineligibility — these are not equivalent, and the implementation (UTV2-1546, UTV2-1555) must be built and
tested against the affirmative-proof framing, not a subtractive one.

## 4. T1-H reserved authority (complete list)

T1-H is Griff-reserved, always, regardless of framing, and is never eligible for T1-M classification. The
Design Packet's deny-list (§2) plus Codex's amendments (`packages/domain/**` added to deny) is the canonical
list. Restated here as the single authoritative enumeration (supersedes any partial list elsewhere):

- `.github/workflows/**`, `.claude/**`, `docs/00_constitution/**`
- `docs/05_operations/{DELEGATION_POLICY,STANDING_GUARDRAILS,EXECUTION_TRUTH_MODEL}*`
- CODEOWNERS, branch protection config, environment protection config
- `r1-r5-rules.json`, merge-gate logic, preflight/truth-check/lane tooling under `scripts/ops/**`
- The tier-classification code itself, the T1-M eligibility allowlist/deny-list files, the delegation charter
- `packages/domain/**`, `packages/contracts/**`, `packages/db/**`, `apps/worker/**` (Codex R2.5 pilot exclusion,
  treated as permanent T1-H, not merely pilot-excluded, until explicitly widened by a future PM decision)
- Secrets/env plumbing, credential handling, new external dependencies, new network egress destinations
- DB migrations (including nominally "reversible" ones)
- Delegation/quorum/tier/identity changes; changes to the eligible-path allowlist
- Spending, legal commitments, public financial/performance claims, destructive/irreversible ops
- Production deploy/activation (`deploy.yml`, canary promote, flag flips, cron enablement, governor toggles)
- Any PR where classification is ambiguous, ties, parse-errors, or the diff is truncated — **fail closed to
  T1-H, no exceptions, no "escalate to a smarter model" branch**

## 5. Reviewer roster fixed before review begins; no shopping; no silent replacement

- The reviewer roster (which seat is filled by which App/service) is fixed at classifier-eligibility time and
  recorded in the round binding (§9). It may not change after review begins.
- A dissenting seat's verdict may never be individually retried. A new review round (triggered by a new head
  SHA) re-opens **all** seats atomically — never one seat in isolation.
- Silent replacement of a reviewer after dissent (swapping which App/model fills a seat mid-round) is
  prohibited. Any roster change requires a new round with a new round ID, and the prior round's dissent is
  preserved in the ledger, not discarded.

## 6. Implementer excluded from all binding votes

The implementer (Claude or Codex lane executor) never holds a voting seat, veto seat, or classifier role for
its own lane, and its self-summary is never provided to reviewers (Design Packet §5, "Context isolation").
This is unconditional — there is no "implementer also reviews if independent enough" carve-out.

## 7. Distinct authenticated identities or independently verifiable channels required for binding votes

A binding vote requires either:
(a) a separately installed GitHub App with its own private key issuing a Check Run (App numeric ID +
installation ID validated, per Codex P1), or
(b) an external reviewer service producing a signed attestation independently verifiable by Merge Gate
(model/provider/request identity, per Codex P0 "identities are not distinct").

Shared-credential output (same App ID, same `GITHUB_TOKEN`, same orchestrator session) can never itself
constitute a binding vote, per §8 below.

**A GitHub App (or external reviewer service identity) authenticates a service, not the underlying model.**
An App ID or attestation ID proves "this check run was issued by installation X holding key Y" — it does not
and cannot prove which model, model version, or vendor produced the content. Model/provider/version identity
is a claim carried *inside* the signed attestation payload (per §7(b) and the `review-verdict/v1` schema's
`provider`/`model` fields, Design Packet R2.2), trusted only to the extent the issuing service is trusted and
its key has not been compromised. Merge Gate validates the service identity mechanically (App ID, installation
ID, signature); it does not and cannot independently verify the model claim inside the payload — that is a
supply-chain trust boundary on the reviewer service itself, not something the quorum algorithm can close.

## 8. Shared-credential model output is advisory only

Any model output produced through infrastructure that does not satisfy §7 (e.g., a model consulted by the
orchestrator through its own session, or a check issued under the shared App ID 15368) is **advisory only**.
It may inform a human's T1-H decision or a repair suggestion, but it can never satisfy a quorum seat, veto
seat, or classifier determination. This closes Codex's P0 "current identities are not distinct" finding at the
policy layer, in addition to the technical identity-architecture work in UTV2-1500.

## 9. Vote binding fields

Every binding vote (and the classifier verdict, and the veto) must carry, at minimum:

`{issue_id, pr_number, head_sha, trusted_base_sha, round_id, reviewer_role, reviewer_identity (App ID +
installation ID, or attestation ID), timestamp, evidence_digest (diff digest the reviewer actually inspected),
files_inspected (full-diff coverage attestation — must equal GitHub's changed-file set for that head_sha)}`

`round_id` is the Design Packet's deterministic full-context derivation (Revision 2 §R2.2):
`SHA256(repository_id || pr_number || issue_id || head_sha || base_ref || base_sha || merge_base_sha ||
criteria_sha256 || policy_revision || roster_revision || charter_revision)`. A vote missing any field in this
tuple — including `round_id` itself or a `files_inspected` set that does not exactly match GitHub's
changed-file list for `head_sha` — is invalid and cannot satisfy a quorum seat. Full-diff coverage is not
satisfied by a summary, a truncated patch read, or a partial file list; per Codex P1 ("review of the actual
diff cannot be guaranteed by prompt wording"), the reviewer must independently fetch every changed file
(blobs where patches truncate) and the attestation is checked mechanically, not trusted on the reviewer's say-so.

## 10. All votes invalidated after any head change

Per Design Packet §6 (unchanged by this synthesis): any push, rebase, force-push, or main advance invalidates
**all** votes and the veto for that PR — no trivial-rebase carve-out. A rebase changes the merged tree even
with an identical diff; the round ID changes; every prior vote is dead.

## 11. Repair bounce cap: 2 (corrected 2026-07-18; supersedes this document's earlier "3" wording)

**Maximum automatic repair count is 2.** This document previously recorded a cap of 3 for ordinary REJECT
verdicts, framed as a deliberate widening of Codex's tighter Revision 2 recommendation of 2. That widening is
**withdrawn** by explicit PM instruction in this session (2026-07-18) — the cap is 2, matching Codex's original
recommendation (`T1M_DELEGATION_CODEX_ADVERSARIAL_REVIEW.md` §2, "Reviewer shopping remains possible through
new heads": *"ordinary correctness rejection: maximum two repair rounds after the initial review"*). The
Design Packet and the Codex review are therefore in full agreement on this point; there is no remaining
Design-Packet/Codex conflict to resolve. Any prior artifact, discussion, or cached summary stating a cap of 3
is stale and superseded by this section.

- **2 automatic bounces** for ordinary technical/architecture/adversarial-seat REJECT verdicts on an
  otherwise-eligible T1-M lane. A third head pushed after a second REJECT freezes the lane and escalates to
  Griff with the complete objection ledger — no further automatic retry.
- **Zero bounces** — immediate T1-H escalation, no repair attempt — for the higher-risk categories in §16
  below: classification disputes, authority-veto firings, suspected prompt injection, identity anomalies,
  ledger anomalies, and any other authority-ambiguity condition. These never consume or reset the 2-bounce
  budget because they never enter the ordinary repair loop at all.
- Each new round (new head after a REJECT) must re-present the complete prior-objection ledger to the same
  seat (§5); a seat cannot be shopped or silently swapped mid-bounce.

## 12. Ambiguous classification defaults to T1-H

Restated from Design Packet §2 and Codex P0 "T1-M cannot presently be derived mechanically": any classifier
output that is `false`, `unknown`, a parse error, a truncated diff, an unrecognized path, or an unrecognized
file kind resolves to `T1H_REQUIRED`. There is no default-permissive path anywhere in the classifier.

## 13. No PR-head executable code in privileged workflows

Restated as an unconditional rule, generalized beyond the specific Merge Gate incident that prompted it
(UTV2-1554): no privileged T1-M or Merge Gate workflow may execute PR-controlled code, load PR-controlled
actions, PR-controlled prompt templates, or PR-controlled schemas, or load the allowlist/charter/roster from
the PR head. All authorization code and policy load from trusted current `main` or an immutable release SHA.
The PR diff is data, never code, in any privileged execution context. (This is the exact class of bug UTV2-1554
exists to fix for the Merge Gate verdict helper specifically; this section generalizes it as a permanent
architectural rule for all future T1-M privileged workflows.)

## 14. Merge and deploy authority remain separated

T1-M quorum (once implemented and activated) authorizes merge to `main` only. Deploy/activation remains T1-H,
Griff-triggered, structurally incapable of being reached by quorum credentials (Design Packet §10, Codex P0
"merge and deployment authority are not separated" — production/canary environment protection, admin-bypass
removal, and reviewer-App permission stripping to Checks:write/PR:read/Contents:read/Metadata:read only, are
prerequisites, not aspirational).

## 15. DELEGATION_STATE required active at four checkpoints

The delegation charter (`docs/governance/T1M_DELEGATION.json` — enabled/expires/revision) must be checked and
valid (present, parseable, unexpired, kill-switch not flipped) at all of: **dispatch, review, certification,
and merge**. This is stricter than checking only at merge-evaluation time; a charter that expires or is killed
mid-flight must halt the lane at whichever of these four checkpoints it is currently at, not only block a
final merge attempt. (Design Packet §11 specifies the kill-switch is checked at all 8 pipeline boundaries;
these four are the subset that must independently gate DELEGATION_STATE specifically, not just the kill
variable.)

## 16. T1-H reserved-action list

Identical to §4 above (this document maintains one authoritative list, not two). See §4.

### 16.1 Immediate-escalation conditions (zero-bounce, no repair attempt)

The following conditions escalate to Griff immediately, consuming none of the 2-bounce ordinary-repair
budget (§11) and requiring no further automatic action:

- **Classification dispute** — any reviewer flags that the classifier's T1M_ELIGIBLE verdict should have been
  T1-H (the most dangerous disagreement — a mechanically-eligible change that a model believes is
  substantively unsafe).
- **Authority-audit veto** — the authority auditor returns EXPANSION or UNSURE (Design Packet §9).
- **Prompt-injection finding** — any reviewer reports suspected injected instructions in diff content, issue
  text, or any other untrusted input.
- **Identity anomaly** — duplicate or conflicting check identities for one seat, an App/installation mismatch,
  a signature that fails verification, or an implementer/reviewer principal collision (Codex fail-closed test
  matrix, "Identity" row).
- **Ledger anomaly** — a broken hash chain, a missing or out-of-order prior-rejection event, a duplicate
  verdict for one seat/round, or a bounce count that disagrees with the ledger's own history (Codex
  §2 "Ledger is not append-only if stored only in check output").
- **Authority ambiguity** — any case where the round binding (§9), the delegation charter (§15), the roster
  (§5), or the classifier policy revision cannot be unambiguously resolved to a single value at evaluation
  time (stale cache, concurrent policy edit mid-round, unreconciled main advance during evaluation).

These six conditions are exhaustive of the "escalate immediately" category; every other REJECT verdict is an
ordinary rejection subject to the 2-bounce cap in §11.

### 16.2 Ledger requirements

Per Codex §2 ("Ledger is not append-only if stored only in check output") and Design Packet R2.2, the review
history for every round is an **external, append-only, hash-chained** store — never "latest check run wins."
Each event hash-chains to its predecessor: `event_hash = SHA256(previous_event_hash || canonical_event)`.
Merge Gate rejects: a broken chain, a duplicate approval for one seat/round, an approval following a reject on
the same round without a new round ID, and any bounce-count value that disagrees with the ledger's own history.
Check runs alone are insufficient because a sufficiently privileged actor can rerequest, replace, or delete
them — the ledger, not the check-run UI state, is the authoritative history (§16.1 "ledger anomaly").

## 17. Bootstrap, rollback, suspension, reviewer-unavailability behavior

- **Bootstrap:** every PR that creates, modifies, enables, or expands quorum authority is itself T1-H and
  merges under the existing Griff-only gate, through final activation. The quorum can never approve its own
  installation (Codex P0 "bootstrap circularity", accepted verbatim — see §20 below).
- **Rollback:** revocation (kill-switch flip, charter expiry, or explicit PM action) freezes in-flight T1-M
  lanes at their next gate boundary; already-merged work is unaffected, since T1-M eligibility itself requires
  `git revert`-clean reversibility — that is the point of the eligibility bar, not an incident-response
  afterthought.
- **Suspension:** identical mechanism to rollback; a suspended charter behaves as an expired one at every
  checkpoint in §15.
- **Reviewer unavailability:** a seat failing to report within timeout is failure, not approval — silence never
  equals approval. At most one automated retry, then the lane pages/escalates to Griff (Design Packet §8,
  citing the UTV2-1517 silent-dispatch incident as the precedent this rule exists to prevent recurring).

## 18. Reconciles UTV2-1500/1501/1503/1506 — does not create competing authority documents

- **UTV2-1500** ("Delegation & Accountability Contract v1", the canonical `docs/05_operations/
  DELEGATION_ACCOUNTABILITY_V1.md` governing document — role matrix, binding-vs-advisory artifacts,
  identity rules, revocation) is the canonical-document home this T1M redesign feeds into; §5–§9 of this
  document (reviewer roster, implementer exclusion, distinct-identity requirement, shared-credential
  advisory-only rule, vote-binding fields) are the T1-M-specific identity rules that UTV2-1500's broader
  contract must incorporate without contradiction. This planning PR is preparatory input to UTV2-1500, not
  a substitute for it — UTV2-1500 remains Blocked Internal (blocked by UTV2-1503) and this document does not
  unblock or close it.
- **UTV2-1501** (Constitution vs T2 self-approval reconciliation) governs the T2 approval path, which this
  document does not alter — T1-M is additive to T1 only, T2's existing `pm-verdict/v1`-or-GitHub-review path
  is unchanged.
- **UTV2-1503** (orchestrator standing authority narrowing) and this document are complementary: 1503 narrows
  what the *orchestrator* may edit unilaterally under standing authority; this document narrows what *any
  machine, including a future T1-M quorum,* may ever approve without Griff. Neither supersedes the other;
  UTV2-1503's narrower orchestrator-authority findings apply with full force inside a future T1-M pipeline too
  (the orchestrator role in §3's authority matrix — "may trigger reviews, never author verdicts" — is the same
  boundary UTV2-1503 independently arrived at from a different angle).
- **UTV2-1506** (runtime reliability agent charter) is out of scope for T1-M entirely — restart/paging authority
  is a distinct charter this document does not modify.
- This document does not introduce a fifth competing authority source. It is subordinate to
  `docs/00_constitution/**` (permanently T1-H, per §4) and to any future ratified `DELEGATION_POLICY.md`
  update; where a future constitutional document conflicts with this synthesis, the constitutional document
  wins per the repo's own authority-precedence rule.

## 19. Implementation and certification issue references

- **UTV2-1555** — "Implement machine-authorized T1-M quorum and human-reserved T1-H classifier." Implements
  this document's architecture. Blocked (per PM instruction, 2026-07-18) by: UTV2-1451, UTV2-1546, UTV2-1500,
  completion of the UTV2-1554 → UTV2-1543 → UTV2-1551 governance train, and stabilization of UTV2-1477
  production recovery. Do not implement or activate ahead of those.
- **UTV2-1556** — "Accelerated, count-gated pilot and certification of T1-M delegation across reconciliation
  and reversible technical lanes." Executes the count-gated (not calendar-gated) pilot in §21 below — the
  pilot completes as soon as its evidence thresholds are met, with no mandatory minimum duration.

## 20. Bootstrap self-authorization disclaimer

This authority change — the T1-M/T1-H architecture itself, its classifier, its identity substrate, and every
PR that builds toward UTV2-1555 — bootstraps entirely under the **existing, Griff-approved T1 rules already in
production today** (human `t1-approved` label + `pm-verdict/v1` APPROVED comment from CODEOWNERS, per
`merge-gate.yml` as currently ratified). It cannot authorize itself. No PR in the UTV2-1451 → UTV2-1546 →
UTV2-1500 → UTV2-1554-class hardening chain may claim T1-M eligibility, be merged by anything other than the
existing Griff-only gate, or treat any interim artifact this architecture produces (a classifier verdict, a
review-verdict check run, a quorum ledger entry) as authoritative until the final Griff-approved activation PR
and separately administered live variable flip (in that order) complete UTV2-1556's certification.

---

## 21. Pilot timing — Revision 3 amendment (count-gated, not calendar-gated)

The pilot is **evidence-count gated, not calendar-gated**. This supersedes any prior "14-day pilot" wording
being read as a mandatory waiting or burn-in period; 14 days is the maximum pilot-authority TTL (charter
expiration/renewal window), never a minimum duration. If certification evidence is satisfied on day 2, the
pilot is complete on day 2.

### 21.1 Pre-pilot sweep (must run before any live merge)

1. The ≥100-historical-PR eligibility sweep (Codex R2.4 issue 5's `t1m-shadow-sweep`, ≥100 recent merged T1 PRs
   classified retroactively).
2. Every seeded attack case: classifier, identity, replay, reviewer-shopping, prompt-injection, stale-head,
   ledger-chain, signed-attestation, and privileged-code-execution attacks (Codex §7 fail-closed test matrix,
   adopted in full).
3. Shadow classification against all currently eligible live lanes.

### 21.2 Count-gated widening

| Stage | Gate | Permitted state |
|---|---|---|
| 1 | First 3 live T1-M merges | One lane at a time, no automatic merge, exact-head quorum required, normal governed merge only after machine disposition verified |
| 2 | After 3 consecutive clean live merges | 2 concurrent eligible T1-M lanes, normal machine-authorized merge under pilot rules |
| 3 | After 10 clean real merges | Eligible T1-M lanes included in the 6-lane acceptance wave |
| 4 | After 15 clean real merges | Eligible T1-M lanes included in the 8-lane acceptance wave |
| 5 | After 20 clean real merges, all seeded attacks passing, zero hard failures, zero orphaned leases/locks/manifests/worktrees | T1-M included in the 10-lane acceptance wave; default activation evaluated |

The 20-merge threshold in Stage 5 must include **at least 5 T1-M/R mechanical-reconciliation lanes and 5
T1-M/T reversible-technical lanes** (§3), not 20 of a single subclass.

### 21.3 Initial pilot exclusions (unchanged from Codex R2.5, restated)

Not eligible in the first live pilot, regardless of count-gate stage, until the pilot widens them explicitly
by a future PM decision: Tier C surfaces, `packages/domain/**`, migrations, production workflows, deployment
paths, secrets/credentials, constitutional or delegation changes, the authority-bearing classifier/quorum
implementation itself, and public performance or financial claims.

### 21.4 Document status

- Design Packet Revision 2 remains authoritative on architecture and security.
- This §21 (mirrored as Revision 3 in `T1M_DELEGATION_DESIGN_PACKET.md`) supersedes only the calendar-based
  pilot timing in Revision 2 — nothing else in Revision 2 is altered by this amendment.
