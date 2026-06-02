# Canonical Program State

> SPRINT-CONSTITUTIONAL-CONVERGENCE-002 · 2026-06-02 · PM-ratified.
> **This is the authoritative human-readable snapshot of constitutional program state.** Any other repo doc, Linear doc, issue metadata, workflow text, or proof artifact that conflicts with this file (or with constitution §18.3) is **drift to reconcile**, not alternate authority.

## Authority statement
- **The repository is authoritative.** This document and `UNIT_TALK_CONSTITUTION_V1.md` are the source of truth for program numbering and activation state.
- **Constitution §18.3 controls program numbering.** P1 Truth · P2 Governance · P3 Decision Integrity · P4 Execution & Economic Truth · P5 Institutional Runtime.
- **Linear is operational tracking only.** Linear certification documents are operational evidence, subordinate to this state and the constitution.
- This document records **PM rulings D-CONST-1 and D-CONST-2** (both `PM_RATIFIED` 2026-06-02). It **advances no certification** — P3, P4, P5 are explicitly *not* certified here.

## Canonical program table

| Program | Constitutional name (§18.3) | Status | Capability layers (§4) | Certification state | Activation state | Current blocker(s) | Allowed work | Forbidden work |
|---|---|---|---|---|---|---|---|---|
| **P1** | Truth Convergence | **ACTIVE_CERTIFIED** | 4.1, 4.2, 4.13 | Certified (Linear `PROGRAM_1_FROZEN_SURFACE`, SHA `9600938`; re-cert deadline 2026-08-25) | Active | Live ingestion stale (D-CONST-6); re-cert of proof_lineage+freshness due 2026-08-25 | freshness/replay re-cert prep; ingestion restoration (no-cost/mock/replay) | new truth-model changes without re-cert |
| **P2** | Governance Convergence | **ACTIVE_CERTIFIED** | 4.15, 4.16 | Certified (governance runtime; 229 live tests) | Active | numbering drift in repo cert doc (D-CONST-1); UTV2-1084 TC-FAIL inventory item | governance hardening; proof-gate execution-binding (D-CONST-4) | weakening any governance guard |
| **P3** | Decision Integrity Convergence | **ACTIVE_NOT_CERTIFIED** | 4.3, 4.4, 4.5, 4.8, 4.9 | **NOT certified** | Active (authorized) | edge-as-echo (D-CONST-5); feature/model/calibration not wired/enforced | scoring truth remediation; feature-wiring audits; injury/status guard; posting-window guard; calibration enforcement; decision explainability; portfolio/risk hardening | claiming P3 certification; claiming proven edge |
| **P4** | Execution & Economic Truth Convergence | **CONDITIONAL_NOT_CERTIFIED** | 4.10, 4.11, 4.12, 4.19 | **NOT certified** | Conditional | dead-letters/SLO (D runtime); no realized CLV/ROI/attribution; no P4 cert doc (D-CONST-3) | execution runtime hardening; dead-letter remediation; settlement proof; CLV proof scaffolding; attribution scaffolding; economic-truth preparation | claiming economic edge; claiming verified ROI; claiming CLV certification before live data proves it |
| **P5** | Institutional Runtime Convergence | **FROZEN_NOT_CERTIFIED** | 4.17, 4.18 (+ burn-in) | **NOT certified** | **FROZEN** | no burn-in PASS; no certification; capital/treasury require both | (none — frozen) adversarial detector code already merged (P5-A) is historical, not an unfreeze | treasury work; capital scaling; live capital deployment; burn-in-derived capital claims without burn-in PASS; any customer-money readiness claim |

## Explicit statuses (canonical)
- **P1 Truth Convergence — ACTIVE_CERTIFIED**
- **P2 Governance Convergence — ACTIVE_CERTIFIED**
- **P3 Decision Integrity — ACTIVE_NOT_CERTIFIED**
- **P4 Execution & Economic Truth — CONDITIONAL_NOT_CERTIFIED**
- **P5 Institutional Runtime — FROZEN_NOT_CERTIFIED**

> This sprint does **not** claim P3 or P4 certification. "Active" and "Conditional" authorize *work*, not certification.

## P5 freeze rules (binding)
While P5 is `FROZEN_NOT_CERTIFIED`:
1. **No treasury work.**
2. **No capital scaling.**
3. **No live capital deployment.**
4. **No burn-in-derived capital claims without a burn-in PASS report.**
5. **No customer-money readiness claim.**

P5-A adversarial detector code (UTV2-1147–1149) is already merged — that is **historical code**, not an unfreeze of the capital layer. P5 stays frozen until burn-in PASS + certification (§4.17, §20.6).

## P3 allowed work (authorized — Decision Integrity is active)
- scoring truth remediation
- feature wiring audits (audit only — not feature wiring implementation this sprint)
- injury/status guard
- posting-window guard
- model calibration enforcement
- decision explainability
- portfolio/risk hardening

## P4 allowed work (conditional)
- execution runtime hardening
- dead-letter remediation
- settlement proof
- CLV proof scaffolding
- attribution scaffolding
- economic truth preparation

## P4 forbidden claims (binding)
- **No proven economic edge.**
- **No verified ROI claim.**
- **No CLV certification claim until live data proves it.**

## Cross-references
- Numbering authority: `UNIT_TALK_CONSTITUTION_V1.md` §18.3
- Drift ledger: `CERTIFICATION_GAP_REGISTER.md`
- Sequence: `CONSTITUTIONAL_CONVERGENCE_BACKLOG_PLAN.md`
- Execution structure: `../02_architecture/CONSTITUTIONAL_LINEAR_EXECUTION_STRUCTURE.md`
