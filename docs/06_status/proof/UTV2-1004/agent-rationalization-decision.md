# UTV2-1004 Agent System Rationalization Decision

**Date:** 2026-05-17  
**Owners:** Claude + PM  
**Status:** RATIFIED (Claude decision — PM review required before any promote-to-service action)

---

## Principle

Agents are prompt files invoked by operators. They cannot be cited as autonomous enforcement. Any guarantee that must hold without human invocation must be encoded in CI, a script, or a persistent service — not left as an agent prompt.

---

## Agent Dispositions

### 1. `proof-auditor`
**Disposition: PROMOTE TO MANDATORY GATE (CI/script)**

Currently optional prompt. Both audits found proof-auditor provides real value but optional invocation means proof completeness gaps pass undetected. SHA binding, placeholder detection, and R-level evidence cannot depend on a human remembering to invoke this.

**Action:** UTV2-1006 (Ready for Codex) — add proof-auditor as a mandatory CI/script gate before T1 PR can merge.  
**Advisory role retained:** Continues to exist as an operator tool for detailed audit output.

---

### 2. `runtime-verifier`
**Disposition: PROMOTE TO MANDATORY READINESS GATE (CI/script)**

Currently optional prompt. Both audits found runtime-verifier is valuable but optional invocation means readiness claims pass without evidence. A production-readiness or merge-readiness claim must not depend on a human invoking this.

**Action:** UTV2-1005 (Ready for Codex) — add runtime-verifier as a mandatory CI/script gate before any readiness claim or merge gate opens.  
**Advisory role retained:** Detailed output still useful for operator investigation.

---

### 3. `db-proof-reviewer`
**Disposition: COLLAPSE INTO proof-auditor gate**

Function overlaps significantly with proof-auditor. Its core check (pnpm test:db evidence in PR body, SHA bound) is already enforced by the "Require live-DB proof for runtime changes" CI workflow. Adding it as a second mandatory gate would duplicate enforcement.

**Action:** No new follow-up issue needed. The `Require live-DB proof for runtime changes` CI check (already active) covers the hard gate. `db-proof-reviewer` remains as an operator advisory tool for detailed T1 evidence review.

---

### 4. `lane-governor`
**Disposition: KEEP AS OPERATOR PROMPT**

Concurrency limit enforcement is already embedded in `/dispatch` and `/dispatch-board` skills. The lane-governor agent provides supplementary advisory output (slot counts, forbidden combinations) but its logic is not a separate enforcement layer — dispatch already checks `LANE_CONCURRENCY_POLICY.md` before opening lanes.

**Action:** No code/CI change needed. Document in agent description that this is advisory-only, not an enforcement gate.

---

### 5. `pr-risk-reviewer`
**Disposition: KEEP AS OPERATOR PROMPT (advisory)**

Risk classification is inherently advisory. The hard gates are CI checks (lane authority, R-level, proof coverage, merge gate). This agent adds context that CI cannot supply (intent, scope bleed, blast radius narrative) but cannot replace CI as the enforcement layer.

**Action:** No code/CI change needed. Agent description already reflects advisory role per UTV2-1008 resolution.

---

### 6. `ci-triage`
**Disposition: KEEP AS OPERATOR PROMPT**

Diagnoses CI failures by reading logs and pattern-matching against known failure types. Inherently reactive — cannot run autonomously without a trigger. Value is in human-readable root-cause analysis, not enforcement.

**Action:** No change. Remains invoked by operators when CI is red.

---

### 7. `lane-reconciler`
**Disposition: KEEP AS OPERATOR PROMPT + SCHEDULE DETECTION**

Reconciles ghost lanes (Linear drift, missing PRs, stale manifests). UTV2-976 already added scheduled stranded lane detection. The full reconciliation (Linear + GitHub + manifest cross-check) is too stateful for fully autonomous scheduling without PM oversight.

**Action:** Retain as operator-invoked prompt. The scheduled detection in UTV2-976 covers the staleness signal. A future issue can promote full reconciliation to a service if drift frequency warrants it.

---

### 8. `codex-return-reviewer`
**Disposition: KEEP AS OPERATOR PROMPT (mandatory step, not automated)**

Reviews Codex PRs before merge: file scope, Tier C paths, test existence, commit format, tier label, R-level compliance. The merge review requires human judgment. Codex output cannot be auto-approved — the standing T2 merge authorization still requires this reviewer to pass before merge.

**Action:** No automation. Retain as required step in Codex review workflow. Document that dispatch-board invokes this before any Codex PR merge.

---

## Summary Table

| Agent | Disposition | Follow-up Issue |
|-------|-------------|-----------------|
| proof-auditor | Promote → mandatory CI gate | UTV2-1006 (Ready for Codex) |
| runtime-verifier | Promote → mandatory readiness gate | UTV2-1005 (Ready for Codex) |
| db-proof-reviewer | Collapse → existing CI check covers it | None |
| lane-governor | Keep as prompt (advisory) | None |
| pr-risk-reviewer | Keep as prompt (advisory) | None |
| ci-triage | Keep as prompt (reactive) | None |
| lane-reconciler | Keep as prompt + existing schedule | None |
| codex-return-reviewer | Keep as prompt (mandatory human step) | None |

---

## Mandatory guarantee inventory

After UTV2-1005 and UTV2-1006 ship:

| Guarantee | Enforcement mechanism | Status |
|-----------|----------------------|--------|
| T1 proof completeness + SHA binding | proof-auditor CI gate (UTV2-1006) | Pending |
| Runtime readiness before merge | runtime-verifier CI gate (UTV2-1005) | Pending |
| Live-DB proof present in T1 PR | "Require live-DB proof" CI check | Active |
| Lane concurrency limits | dispatch-board + LANE_CONCURRENCY_POLICY.md | Active |
| R-level artifact coverage | r-level-check.ts CI check | Active |
| Tier label required | tier-label-check CI workflow | Active |

No mandatory guarantee remains as optional prompt-only invocation after UTV2-1005 and UTV2-1006 ship.
