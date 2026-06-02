# Unit Talk Constitution — Entry Point

> **SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001** · Restored 2026-06-02.
> This directory is the canonical home of the Unit Talk Constitution. The constitution was recovered from `UNIT_TALK_CONSTITUTION_V1.md` and restored here **verbatim** so it cannot disappear again.

## Authority statement

The **repository is authoritative.** The constitution lives in version control, is SHA-pinned, and is preserved by a CI guard (`scripts/constitution-check.ts`). Linear is **operational tracking only** — Linear documents (certification records, program policies) are governed *by* this constitution, not the other way around.

This restoration changed **no constitutional doctrine, no capability layers, no certification status, and no runtime behavior.** It only made the constitution durable, navigable, and mapped to implementation reality. Where implementation does not match the constitution, the gap is reported explicitly — never papered over.

## Preservation integrity

| Field | Value |
|---|---|
| Source file | `UNIT_TALK_CONSTITUTION_V1.md` (recovered) |
| Restored path | `docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md` |
| SHA-256 (pinned) | `b22b6e5b47ece0d2b04688ad4b29e2fc3cb20fd09d00e50f91ac1e5fe3e2efc5` |
| Lines | 2483 |
| Capability layers | 19 (§4.1–§4.19) |
| Principles | 14 (§2.1–§2.14) |
| Programs | 5 (§18.3) |
| Maturity stages | 6 (§16) |

The constitution file is intentionally kept **byte-for-byte verbatim** (not edited with an inline ToC) so its SHA stays tamper-evident. Navigation lives here in the README; `constitution-check.ts` verifies the SHA and structural completeness on every run.

## Constitutional hierarchy (truth order)

1. **The Constitution** (`UNIT_TALK_CONSTITUTION_V1.md`) — supreme doctrine. Laws, layers, programs, end state.
2. **Repo enforcement code** — the mechanical realization (`packages/contracts`, `packages/invariants`, `packages/db`, DB triggers). Where code and constitution disagree, that is **drift to be fixed**, not a new rule.
3. **Proof bundles** (`docs/06_status/proof/**`) — SHA-bound evidence that a layer is implemented/certified.
4. **Linear certification documents** — operational record of certification state. Subordinate to repo proof + this constitution.
5. **Linear board / labels / chat** — operational tracking and evidence surfaces only. Never canonical (constitution §2.10).

> Note: the constitution (§18.3) is the **tie-breaker for program numbering**. Programs are: P1 Truth · P2 Governance · P3 Decision Integrity · P4 Execution & Economic Truth · P5 Institutional Runtime. Any repo doc using a different numbering is drifted (see `CONSTITUTIONAL_DRIFT_AUDIT.md`).

## Constitutional artifacts (this directory)

| File | Purpose |
|---|---|
| [`UNIT_TALK_CONSTITUTION_V1.md`](./UNIT_TALK_CONSTITUTION_V1.md) | The constitution itself — verbatim, supreme authority |
| [`CONSTITUTION_IMPLEMENTATION_MATRIX.md`](./CONSTITUTION_IMPLEMENTATION_MATRIX.md) | Section → repo implementation → enforcement → tests → CI gates → status |
| [`CONSTITUTIONAL_DRIFT_AUDIT.md`](./CONSTITUTIONAL_DRIFT_AUDIT.md) | Per-layer: Implemented / Partial / Missing / Bypassed / Superseded |
| [`PROGRAM_ALIGNMENT_MATRIX.md`](./PROGRAM_ALIGNMENT_MATRIX.md) | Programs 1–5 → layers, issues, workstreams, certifications, runtime |
| [`../02_architecture/CONSTITUTIONAL_LINEAR_EXECUTION_STRUCTURE.md`](../02_architecture/CONSTITUTIONAL_LINEAR_EXECUTION_STRUCTURE.md) | Constitution → Programs → Workstreams → Issues → Proof → Certifications |

Preservation guard: [`scripts/constitution-check.ts`](../../scripts/constitution-check.ts) (`pnpm constitution:check`).
Restoration proof bundle: [`../06_status/proof/SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001/`](../06_status/proof/SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001/).

## Table of contents (constitution)

- [0. Preamble](./UNIT_TALK_CONSTITUTION_V1.md#0-preamble)
- [1. Constitutional Objective](./UNIT_TALK_CONSTITUTION_V1.md#1-constitutional-objective)
- [2. Constitutional Principles](./UNIT_TALK_CONSTITUTION_V1.md#2-constitutional-principles) — 2.1 Truth Before Prediction · 2.2 Determinism Before Automation · 2.3 Fail Closed · 2.4 Immutable History · 2.5 Explicit Authority · 2.6 Replayability · 2.7 Auditability · 2.8 Separation of Duties · 2.9 Human Governance · 2.10 Labels Are Evidence Not Truth · 2.11 Proof Over Narrative · 2.12 Revocable Trust · 2.13 Adversarial Validation · 2.14 No Self-Certification
- [3. System Mission and Scope](./UNIT_TALK_CONSTITUTION_V1.md#3-system-mission-and-scope)
- [4. System Capability Layers](./UNIT_TALK_CONSTITUTION_V1.md#4-system-capability-layers) — **the 19 layers**:
  - [4.1 Data Acquisition](./UNIT_TALK_CONSTITUTION_V1.md#41-data-acquisition-layer) · [4.2 Canonical Data Truth](./UNIT_TALK_CONSTITUTION_V1.md#42-canonical-data-truth-layer) · [4.3 Feature Engineering](./UNIT_TALK_CONSTITUTION_V1.md#43-feature-engineering-layer) · [4.4 Modeling & Prediction](./UNIT_TALK_CONSTITUTION_V1.md#44-modeling-and-prediction-layer) · [4.5 Calibration & Model Governance](./UNIT_TALK_CONSTITUTION_V1.md#45-calibration-and-model-governance-layer)
  - [4.6 Edge Detection](./UNIT_TALK_CONSTITUTION_V1.md#46-edge-detection-layer) · [4.7 Risk Management](./UNIT_TALK_CONSTITUTION_V1.md#47-risk-management-layer) · [4.8 Portfolio & Exposure](./UNIT_TALK_CONSTITUTION_V1.md#48-portfolio-and-exposure-management-layer) · [4.9 Decision Engine](./UNIT_TALK_CONSTITUTION_V1.md#49-decision-engine-layer) · [4.10 Execution & Distribution](./UNIT_TALK_CONSTITUTION_V1.md#410-execution-and-distribution-layer)
  - [4.11 Settlement & Outcome](./UNIT_TALK_CONSTITUTION_V1.md#411-settlement-and-outcome-verification-layer) · [4.12 Performance Evaluation](./UNIT_TALK_CONSTITUTION_V1.md#412-performance-evaluation-layer) · [4.13 Runtime Integrity](./UNIT_TALK_CONSTITUTION_V1.md#413-runtime-integrity-layer) · [4.14 Observability](./UNIT_TALK_CONSTITUTION_V1.md#414-observability-layer) · [4.15 Governance & Certification](./UNIT_TALK_CONSTITUTION_V1.md#415-governance-and-certification-layer)
  - [4.16 Human Operations](./UNIT_TALK_CONSTITUTION_V1.md#416-human-operations-layer) · [4.17 Capital Operations & Treasury](./UNIT_TALK_CONSTITUTION_V1.md#417-capital-operations-and-treasury-layer) · [4.18 Market Adversarial Intelligence](./UNIT_TALK_CONSTITUTION_V1.md#418-market-adversarial-intelligence-layer) · [4.19 Economic Attribution](./UNIT_TALK_CONSTITUTION_V1.md#419-economic-attribution-and-performance-decomposition-layer)
- [5. Component Architecture](./UNIT_TALK_CONSTITUTION_V1.md#5-component-architecture)
- [6. Technical Stack Requirements](./UNIT_TALK_CONSTITUTION_V1.md#6-technical-stack-requirements)
- [7. Canonical Domain Model](./UNIT_TALK_CONSTITUTION_V1.md#7-canonical-domain-model)
- [8. Contracts and Interfaces](./UNIT_TALK_CONSTITUTION_V1.md#8-contracts-and-interfaces)
- [9. Operating Model](./UNIT_TALK_CONSTITUTION_V1.md#9-operating-model)
- [10. Proof and Certification Framework](./UNIT_TALK_CONSTITUTION_V1.md#10-proof-and-certification-framework)
- [11. Security and Trust Architecture](./UNIT_TALK_CONSTITUTION_V1.md#11-security-and-trust-architecture)
- [12. Infrastructure and Runtime Topology](./UNIT_TALK_CONSTITUTION_V1.md#12-infrastructure-and-runtime-topology)
- [13. Organizational and Governance Structure](./UNIT_TALK_CONSTITUTION_V1.md#13-organizational-and-governance-structure)
- [14. Multi-Agent and Automation Architecture](./UNIT_TALK_CONSTITUTION_V1.md#14-multi-agent-and-automation-architecture)
- [15. Temporal and Consistency Architecture](./UNIT_TALK_CONSTITUTION_V1.md#15-temporal-and-consistency-architecture)
- [16. Maturity Model](./UNIT_TALK_CONSTITUTION_V1.md#16-maturity-model) — Stages 1–6
- [17. Audit Framework](./UNIT_TALK_CONSTITUTION_V1.md#17-audit-framework)
- [18. Implementation Roadmap](./UNIT_TALK_CONSTITUTION_V1.md#18-implementation-roadmap) — Programs 1–5 (§18.3)
- [19. Workflow Runtime Addendum](./UNIT_TALK_CONSTITUTION_V1.md#19-workflow-runtime-addendum)
- [20. Board Execution Runtime Addendum](./UNIT_TALK_CONSTITUTION_V1.md#20-board-execution-runtime-addendum)
- [21. Current Program 1 Constitutional Sequence](./UNIT_TALK_CONSTITUTION_V1.md#21-current-program-1-constitutional-sequence)
- [22. Constitutional Anti-Patterns](./UNIT_TALK_CONSTITUTION_V1.md#22-constitutional-anti-patterns)
- [23. Constitutional End State](./UNIT_TALK_CONSTITUTION_V1.md#23-constitutional-end-state)
