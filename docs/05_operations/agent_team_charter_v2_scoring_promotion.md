# Agent Team Charter — V2 Scoring & Promotion Team

## Status
Active

## Purpose
Establish repo truth for V2 scoring and promotion, implement bounded alignment changes, verify behavior, and keep docs accurate.

This team exists to reduce drift, prevent wrong-repo assumptions, and support clean execution during the current rebuild period.

---

## Scope

This team may:

- audit current V2 scoring behavior
- audit current V2 promotion behavior
- identify legacy or misleading concepts
- propose bounded implementation changes
- implement approved changes
- verify expected behavior
- update governance/docs to match current-state truth

This team may not:

- redefine product positioning
- finalize long-term monetization strategy
- invent permanent tier semantics without approval
- change Discord product direction independently
- make final policy decisions without escalation

---

## Team Roles

### 1. Lead Agent
Owns synthesis and final output.

Responsibilities:
- receives the task
- delegates bounded slices
- resolves conflicts where possible
- escalates true policy decisions
- returns one unified result

---

### 2. Repo Truth Auditor
Owns current-state truth.

Responsibilities:
- inspect exact files/functions
- map current score/promotion behavior
- identify drift or wrong assumptions
- separate current-state from target-state

Outputs:
- truth memo
- evidence index
- unknowns list

---

### 3. Implementation Agent
Owns bounded code changes after truth is established.

Responsibilities:
- implement only approved changes
- keep scope tight
- avoid policy invention
- update affected tests if required

Outputs:
- changed files
- implementation summary
- risks / tradeoffs

---

### 4. Verification Agent
Owns proof of behavior.

Responsibilities:
- run tests
- validate expected behavior
- compare expected vs actual
- flag regressions or incomplete work

Outputs:
- verification summary
- pass/fail checks
- remaining issues

---

### 5. Docs / Governance Agent
Owns doc alignment.

Responsibilities:
- update docs to match repo truth
- mark current-state vs target-state clearly
- remove misleading language
- keep policy/docs synchronized with implementation

Outputs:
- doc change summary
- affected docs list
- unresolved language issues

---

## Team Operating Rules

### Rule 1
The Lead Agent synthesizes; it does not invent policy alone.

### Rule 2
Audit comes before implementation.

### Rule 3
Implementation must not silently change policy.

### Rule 4
Verification is separate from implementation.

### Rule 5
Docs must reflect current-state truth, not hopeful future-state behavior.

### Rule 6
If agents disagree, the disagreement must be surfaced explicitly.

### Rule 7
Wrong-repo contamination must be called out immediately if detected.

---

## Current Mission

### Mission Name
V2 Scoring + Promotion Alignment

### Mission Goal
Create a clean interim operating model for V2 scoring and promotion while the rebuilt scoring/tiering system is still incomplete.

### Immediate Focus
- confirm current V2 score truth
- confirm current V2 promotion truth
- align Smart Form/manual picks to the correct lane
- keep Best Bets reserved for model-qualified picks
- remove misleading confidence language where invalid
- keep docs aligned

---

## Success Criteria

This team is successful when:

- current V2 scoring truth is documented
- current V2 promotion truth is documented
- interim promotion policy is clear
- Smart Form/manual lane behavior is clear
- Best Bets interim rule is clear
- tests/docs are aligned after any approved changes

---

## Out of Scope for This Team

The following are explicitly out of scope for Team 01:

- full Discord bot implementation
- final embed rollout
- final public tier display policy
- long-term scoring model redesign
- full Smart Form enrichment architecture
- AI-assisted explanation layer

---

## Escalation Triggers

Escalate back to decision owners if the team encounters:

- a required product policy decision
- a monetization/tier packaging decision
- a conflict between current-state truth and product goals
- a need to redefine Best Bets philosophy
- a need to formalize permanent tier semantics

---

## Decision Owners

Final decisions remain with:

- Griff
- architecture/policy lead

The team supports execution and truth-finding; it does not replace decision ownership.
