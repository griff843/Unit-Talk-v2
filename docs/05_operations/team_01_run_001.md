# Team 01 Run 001

## Team Name
V2 Scoring & Promotion Team

## Mission Name
Run 001 — Interim Scoring & Promotion Alignment

## Working Directory
C:/dev/Unit-Talk-v2

## Objective
Establish current-state truth for V2 scoring and promotion, align interim promotion behavior to that truth, remove misleading confidence-based language where invalid, and keep Best Bets reserved for model-qualified picks during the rebuild period.

This run exists to stop guessing and create one clean operating baseline for scoring, promotion, and related Discord/product docs.

---

## Decision Boundary

This run may:
- audit current V2 scoring behavior
- audit current V2 promotion behavior
- identify misleading or legacy terminology
- align docs to current-state truth
- propose bounded implementation changes
- implement approved bounded changes if explicitly authorized
- verify doc/code alignment where relevant

This run may not:
- redesign the long-term scoring model
- finalize permanent tier semantics
- redefine product positioning
- change monetization strategy
- broaden into full Discord bot implementation
- assume production-repo logic applies to V2

---

## Assigned Roles

- Lead Agent
- Repo Truth Auditor
- Implementation Agent
- Verification Agent
- Docs / Governance Agent

---

## Phase A — Audit

### Questions to answer
1. What is the exact V2 scoring formula currently in use?
2. What is the exact V2 promotion logic currently in use?
3. What currently blocks Smart Form/manual picks from promotion?
4. What does `confidence` actually mean in V2?
5. Does V2 currently have any real tier system, or only score + promotion status?
6. What parts of current docs are misaligned with repo truth?

### Required outputs
- truth memo
- evidence index
- unknowns list
- misalignment list

### Current known baseline to verify
All items below are **hypotheses only**. Treat each as unverified until confirmed against repo truth.

- V2 score is a five-input weighted formula
- Smart Form V1 defaults deterministically to 61.5
- confidenceFloor is a hard blocker before score gate
- V2 has no real tier concept yet
- interim concept should use:
  - manual/capper lane
  - model-qualified lane
  - operator override lane

Do not assume any of these are true. Verify each against actual code before drawing conclusions.

---

## Phase B — Decision Handoff

### Lead Agent must produce
- concise synthesis of current V2 truth
- recommended interim operating model
- recommended wording changes for docs
- explicit list of product/policy decisions that still require escalation

### Required decisions to surface
- Should confidence be treated as deprecated language in V2 docs?
- Should Smart Form/manual picks remain manual/capper lane only during rebuild?
- Should Best Bets remain model-qualified only during the interim period?

---

## Phase C — Implementation

## Default mode
**Docs-first alignment only.**

Code changes require explicit authorization from Griff before proceeding. After Phase B synthesis, if code changes are recommended, **stop and request authorization**. Do not implement code changes speculatively. Do not assume prior approval carries forward.

### Approved docs scope
The team may update or align:
- `docs/discord/pick_promotion_interim_policy.md`
- `docs/discord/discord_message_contract_matrix.md`
- `docs/discord/daily_cadence_spec.md`
- any V2 audit docs that still imply tier exists today in implementation
- any docs that misuse confidence as a meaningful product authority

### If bounded code changes are later approved
Potential candidates may include:
- removing misleading confidence language/comments
- clarifying current promotion status naming
- adding TODO/deprecation notes where appropriate

### Must not change without explicit approval
- scoring formula
- promotion thresholds
- Smart Form submission behavior
- Best Bets implementation logic
- any permanent tier implementation
- any Discord runtime behavior

---

## Phase D — Verification

### Required checks
- confirm audited files/functions support the conclusions
- confirm updated docs match current V2 truth
- confirm no cross-repo contamination remains in affected docs
- if code changes are approved, run affected tests/checks and summarize results

### Required output
- verification summary
- pass/fail checks
- doc alignment confirmation
- remaining inconsistencies

---

## Phase E — Documentation

### Docs to update
At minimum, evaluate and align:

- `docs/discord/pick_promotion_interim_policy.md`
- `docs/discord/discord_message_contract_matrix.md`
- `docs/discord/daily_cadence_spec.md`
- `docs/02_architecture/tier_system_design_spec.md` (only to ensure it is clearly framed as design-contract/target-state, not current V2 implementation truth)
- `docs/audits/v2_score_promotion_truth_audit.md`

If any referenced doc does not exist, **create it** with current-state truth from the audit. Do not skip a doc because it is missing — missing docs are part of the drift problem this run is solving.

### Required behavior
- distinguish **current-state truth** from **target-state design**
- remove misleading "confidence" language if it implies a meaningful business signal
- do not remove tiers as a design concept
- do clearly state that tiers are not currently implemented in V2 runtime
- align Best Bets language to model-qualified-only interim policy

---

## Expected Deliverables

### 1. Audit synthesis
Short markdown summary of:
- current V2 score truth
- current V2 promotion truth
- Smart Form/manual lane truth
- confidence meaning in V2
- whether tiers are implemented or only planned

### 2. Doc alignment summary
List of:
- docs changed
- exact language corrected
- remaining open wording risks

### 3. Implementation recommendation list
Small list of:
- immediate doc-only actions
- optional code cleanup actions
- later rebuild tasks

### 4. Open decisions
Anything that still requires Griff + architecture/policy lead

---

## Final Output Format

### 1. Executive Summary
One short paragraph with the final synthesized outcome.

### 2. Repo Truth Findings
Bullet list of actual V2 truths found.

### 3. Doc Misalignments Found
Bullet list of docs or statements that were inconsistent with repo truth.

### 4. Changes Made
Bullet list of actual changes completed in this run.

### 5. Verification Results
Pass/fail summary for doc/code alignment.

### 6. Open Decisions
Bullet list of unresolved product/policy decisions.

### 7. Follow-Up Recommendations
Short prioritized list of next actions.

---

## Success Criteria

This run is successful when:

- current V2 scoring truth is clearly documented
- current V2 promotion truth is clearly documented
- Smart Form/manual lane behavior is explicitly defined
- Best Bets interim rule is clearly defined
- confidence is no longer treated as a fake business authority in docs
- target-state tier design remains intact without being misrepresented as current implementation
- affected docs no longer drift from V2 truth

---

## Failure Conditions

This run fails if:
- repo truth remains ambiguous after audit
- docs still mix production-repo logic with V2 logic
- confidence remains described as a meaningful promotion authority without evidence
- tiers are described as currently implemented in V2 runtime
- Best Bets eligibility remains unclear
- changes broaden beyond approved scope

---

## Notes

### Current framing to preserve
- tiers remain a **design contract** and future system layer
- manual/capper picks should still be silently evaluable in the future
- system scoring should not publicly contradict cappers
- Best Bets should remain the strictest premium surface

### Important distinction
This run is about:
- **current V2 truth**
- **interim operating clarity**

It is **not** the final tier-engine implementation run.
