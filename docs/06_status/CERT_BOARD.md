# PROGRAM 1 CERTIFICATION BOARD

> **CONSTITUTIONAL RECONCILIATION NOTICE**
> As of SPRINT-CONSTITUTIONAL-CONVERGENCE-002, the canonical program numbering and activation state are defined by `docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md` §18.3 and `docs/00_constitution/CANONICAL_PROGRAM_STATE.md`. This document is historical or partially drifted where it conflicts. Do not use this file as authority for Program numbering or activation status without checking the canonical program state.
> **Specific drift (D-CONST-1/2, PM_RATIFIED):** entries stating "Program 2 = WS-1.x" and "P1–P4 certified gate … SATISFIED" are **non-canonical**. Per §18.3 Program 2 = Governance; per PM ruling P3 = ACTIVE_NOT_CERTIFIED and P4 = CONDITIONAL_NOT_CERTIFIED, so the "P1–P4 certified" gate is **NOT satisfied** and **P5 remains FROZEN**. This file's own header already notes it is rank-5 context (Linear/canonical state authoritative).

> Canonical cert-class classification for all issues as of 2026-05-26 PM Directive.
> Governing issue: UTV2-1177 (PROGRAM-1-CERTIFICATION-REVIEW)
> Governing document: PROGRAM_1_CERTIFICATION_GATE (Linear doc)
> Truth hierarchy rank: this document is rank-5 context — Linear label state is authoritative.

---

## Classification Key

| Class | Label | Meaning |
|---|---|---|
| ACTIVE_CERT | `cert-class:active` | Directly required for P1 cert legitimacy. Dispatch immediately. |
| SUPPORT_CERT | `cert-class:support` | Improves cert confidence/auditability. Dispatch after ACTIVE_CERT clears. |
| POST_CERT | `cert-class:post` | Valid work. Deferred until P1 certified. |
| FROZEN | `cert-class:frozen` | Constitutionally blocked until future programs. Do not activate. |

---

## Shipped Foundations (WS-2.2 — Done)

| Issue | Component | Status |
|---|---|---|
| UTV2-1100 | ProofBundle Entity + Contract | done |
| UTV2-1101 | Replay Harness + Driver | done |
| UTV2-1102 | Invariant Registry + Engine | done |
| UTV2-1103 | Divergence Engine + Quarantine + Escalation | done |

---

## ACTIVE_CERT — 5 Issues (dispatch immediately)

Sequential chain: 1096 → 1097 → 1098 → 1099
Parallel track: 1106 (independent, can run with 1096)

| Issue | Title | Dependency | Why Blocking |
|---|---|---|---|
| UTV2-1096 | INIT-2.1.1 — Certification Entity and Lifecycle States | WS-2.2 done | No DB entity for cert state → cert is narrative-only |
| UTV2-1097 | INIT-2.1.2 — Certification Lifecycle Manager | 1096 merged | No runtime to transition cert states |
| UTV2-1098 | INIT-2.1.3 — Revocation Trigger Wiring | 1097 merged | Cert cannot be invalidated when legitimacy breaks |
| UTV2-1099 | INIT-2.1.4 — Dependent-Gate Certification Checks | 1097+1098 merged | No domain dependency enforcement → cert is self-reported |
| UTV2-1106 | INIT-2.3.3 — Bypass Reclassification | None (parallel) | fail-open bypass = automatic cert failure per PROGRAM_1_CERT_GATE §4 |

---

## SUPPORT_CERT — 6 Issues (dispatch after ACTIVE_CERT)

| Issue | Title | Dependency |
|---|---|---|
| UTV2-1105 | INIT-2.3.2 — Mechanical Expiration Enforcement | INIT-2.3.1 |
| UTV2-1107 | INIT-2.3.4 — Database-Layer FSM Enforcement | INIT-2.3.3 (1106) |
| UTV2-1108 | INIT-2.4.1 — Scoped Roles and Authority Matrices | P1 certified |
| UTV2-1109 | INIT-2.4.2 — Dual-Authorization Runtime | 1108 |
| UTV2-1110 | INIT-2.4.3 — Approval Expiration | 1109 |
| UTV2-1111 | INIT-2.4.4 — Service-Role Constraint and RLS | 1108 |

---

## POST_CERT — 33 Issues (activate after P1 certified)

### INIT-3.x — Decision Integrity (20 issues)

| Issue | Title | Stage |
|---|---|---|
| UTV2-1112 | INIT-3.1.1 — FeatureVector Entity and Schema Registry | 4 |
| UTV2-1113 | INIT-3.1.2 — Future-Leakage Detector | 4 |
| UTV2-1114 | INIT-3.1.3 — Imputation Removal | 4 |
| UTV2-1115 | INIT-3.1.4 — Feature Extractor Integration or Retirement | 4 |
| UTV2-1116 | INIT-3.2.1 — Immutable ModelVersion with Artifact SHA | 4 |
| UTV2-1117 | INIT-3.2.2 — SHA Verification at Inference | 4 |
| UTV2-1118 | INIT-3.2.3 — Real Shadow Inference | 4 |
| UTV2-1119 | INIT-3.2.4 — Rollback Runtime | 4 |
| UTV2-1120 | INIT-3.3.1 — Breach-to-Deployment-State Wiring | 4 |
| UTV2-1121 | INIT-3.3.2 — Shadow-to-Active Calibration Gate | 4 |
| UTV2-1122 | INIT-3.3.3 — Cohort-Level Holds | 4 |
| UTV2-1123 | INIT-3.3.4 — Advisory-Path Removal | 4 |
| UTV2-1124 | INIT-3.4.1 — Immutable DecisionRecord | 4 |
| UTV2-1125 | INIT-3.4.2 — Edge-Price Freshness Enforcement | 4 |
| UTV2-1126 | INIT-3.4.3 — Negative-EV Rejection Routing | 4 |
| UTV2-1127 | INIT-3.4.4 — forcePromote to Exception Runtime | 4 |
| UTV2-1128 | INIT-3.5.1 — Central PortfolioExposure Store | 4 |
| UTV2-1129 | INIT-3.5.2 — Serializable Exposure Consistency | 4 |
| UTV2-1130 | INIT-3.5.3 — Drawdown Monitor and Atomic Halt | 4 |
| UTV2-1131 | INIT-3.5.4 — Concentration Hard Blocks | 4 |

### INIT-4.x — Execution and Economic Truth (12 issues)

| Issue | Title | Stage |
|---|---|---|
| UTV2-1132 | INIT-4.1.1 — ExecutionIntent Entity | 5 |
| UTV2-1133 | INIT-4.1.2 — Idempotent Re-Confirm Receipt Fix | 5 |
| UTV2-1134 | INIT-4.1.3 — Exception-Gated Dead-Letter Recovery | 5 |
| UTV2-1135 | INIT-4.2.1 — updatePayload Surface Removal | 5 |
| UTV2-1136 | INIT-4.2.2 — settlement_records Immutability Trigger | 5 |
| UTV2-1137 | INIT-4.2.3 — Dual-Authorized Corrections | 5 |
| UTV2-1138 | INIT-4.3.1 — Verified Closing-Source Hierarchy | 5 |
| UTV2-1139 | INIT-4.3.2 — Opening-Line Proxy Removal | 5 |
| UTV2-1140 | INIT-4.3.3 — Fallback Audit Events | 5 |
| UTV2-1141 | INIT-4.4.1 — Attribution Engine | 5 |
| UTV2-1142 | INIT-4.4.2 — Reproducible Performance Cohorts | 5 |
| UTV2-1143 | INIT-4.4.3 — Edge Decay Detector | 6 |

### INIT-5.3.x — Burn-In (2 issues, activate after P1+P2)

| Issue | Title | Stage |
|---|---|---|
| UTV2-1150 | INIT-5.3.1 — Burn-In Orchestration and Monitoring Harness | 6 |
| UTV2-1151 | INIT-5.3.2 — 30-Day Burn-In Execution | 6 |

### Other POST_CERT

| Issue | Title | Notes |
|---|---|---|
| UTV2-1032 | DEVELOPING label proof run | data-gated: needs 50+ real-edge picks |
| UTV2-885 | Discord game-thread routing | feature work |
| UTV2-884 | Discord member DM routing | feature work |

---

## FROZEN — 10 Issues (do not activate)

Activation criteria: future programs only, after P1–P4 certified AND applicable milestone decisions.

### Treasury Runtime (INIT-5.1.x)

| Issue | Title | Activation Gate |
|---|---|---|
| UTV2-1144 | INIT-5.1.1 — Immutable Capital Ledger | P1–P4 certified + M10 Path A |
| UTV2-1145 | INIT-5.1.2 — Reserve Tracking and Capital-Level Drawdown | 1144 certified |
| UTV2-1146 | INIT-5.1.3 — Dual-Authorized Treasury Operations | 1145 certified |

### Adversarial Capital Runtime (INIT-5.2.x)

| Issue | Title | Activation Gate |
|---|---|---|
| UTV2-1147 | INIT-5.2.1 — Independent Data Path | P1–P4 certified |
| UTV2-1148 | INIT-5.2.2 — Manipulation and Provider-Anomaly Detectors | 1147 certified |
| UTV2-1149 | INIT-5.2.3 — First-Class Escalation Wiring | 1148 certified |

### Capital Scaling Runtime (INIT-5.4.x)

| Issue | Title | Activation Gate |
|---|---|---|
| UTV2-1152 | INIT-5.4.1 — Scaling Authorization Runtime | 1151 + 1146 certified |
| UTV2-1153 | INIT-5.4.2 — Edge-Persistence, Liquidity, and Survivability Gates | 1152 + 1143 certified |
| UTV2-1154 | INIT-5.4.3 — Simulation Runtime Integration | 1153 certified |

### Concurrency Expansion

| Issue | Title | Activation Gate |
|---|---|---|
| UTV2-1176 | 7-lane orchestration burn-in | Needs PM Decision — frozen until constitutional bottleneck is review quality not throughput |

---

## Concurrency Discipline

Current operational model: **6 lanes total — Claude: 2, Codex: 4, merge serialized.**

Do NOT increase concurrency. Do NOT activate UTV2-1176. The bottleneck is constitutional review quality, not throughput.

---

## Certification Exit Criteria (from PROGRAM_1_CERTIFICATION_GATE)

Program 1 certified when ALL of the following are mechanically verified:

- [x] Replay truth is reproducible — UTV2-1101 #869 (05b58ec4); CertificationLifecycleManager UTV2-1097 #881 (c6e03cc8)
- [x] Invariants are enforceable — UTV2-1102 #870 (bab99bf2)
- [x] Divergence is bounded — UTV2-1103 #871 (46ded96f)
- [x] Quarantine is reliable — UTV2-1103 #871 (46ded96f); bypass reclassification UTV2-1106 #880 (e6b0e27d)
- [x] Proof lineage is traceable — UTV2-1100 #868 (142c1f7c); lineage manager UTV2-1097 #881 (c6e03cc8)
- [x] Freshness is enforceable — UTV2-1097 #881 (c6e03cc8)
- [x] Certification evidence is audit-valid — INIT-2.1.x full chain: UTV2-1096 (efef79d5), UTV2-1097 (c6e03cc8), UTV2-1098 (41ee170d), UTV2-1099 #884 (e3a247e1)

---

## PM Certification Declaration

**PROGRAM 1 CERTIFIED**
Date: 2026-05-30
Authority: PM (griffadavi)

### Certification Basis

**WS-2.2 Shipped Foundations (all done):**
| Issue | Component | Merge SHA | PR |
|---|---|---|---|
| UTV2-1100 | ProofBundle Entity + Contract | 142c1f7c | #868 |
| UTV2-1101 | Replay Harness + Driver | 05b58ec4 | #869 |
| UTV2-1102 | Invariant Registry + Engine | bab99bf2 | #870 |
| UTV2-1103 | Divergence Engine + Quarantine + Escalation | 46ded96f | #871 |

**ACTIVE_CERT Chain (all done, sequential 1096→1097→1098→1099, parallel 1106):**
| Issue | Component | Merge SHA | PR |
|---|---|---|---|
| UTV2-1096 | Certification Entity and Lifecycle States | efef79d5 | — |
| UTV2-1097 | Certification Lifecycle Manager | c6e03cc8 | #881 |
| UTV2-1098 | Revocation Trigger Wiring | 41ee170d | — |
| UTV2-1099 | Dependent-Gate Certification Checks | e3a247e1 | #884 |
| UTV2-1106 | Bypass Reclassification | e6b0e27d | #880 |

**SUPPORT_CERT Chain (all done):**
| Issue | Component | Merge SHA | PR |
|---|---|---|---|
| UTV2-1105 | Mechanical Expiration Enforcement | c40678e3 | #882 |
| UTV2-1107 | Database-Layer FSM Enforcement | 0887296b | #901 |
| UTV2-1108 | Scoped Roles and Authority Matrices | e29ed568 | #902 |
| UTV2-1109 | Dual-Authorization Runtime | ed80f803 | #903 |
| UTV2-1110 | Approval Expiration | a98992dc | #904 |
| UTV2-1111 | Service-Role Constraint and RLS | 7622c7dc | #905 |

### Effect

- POST_CERT Stage 4 (INIT-3.x / Program 3): complete (UTV2-1112–1131, all merged and truth-checked)
- POST_CERT Stage 5 (INIT-4.x / Program 4): **authorized to activate** as of this declaration
- FROZEN (INIT-5.x / capital / treasury / scaling): remains frozen pending P1–P4 certified AND milestone decisions
- Program 1 certification topology: untouched — no mutations to certified artifacts

---

## Program 2 Certification Declaration

**PROGRAM 2 CERTIFIED**
Date: 2026-06-01
Authority: PM (griffadavi)

Program 2 = WS-1.x Constitutional Foundation Layer (INIT-1.x):
WS-1.1 (UTV2-1083–1087), WS-1.2 (UTV2-1091–1095), WS-1.3 (UTV2-1088–1094)

All 13 issues truth-check PASS. No waivers. Recovery commit: 7cc4ffe4.
Full basis: docs/06_status/programs/PROGRAM_2_CERTIFICATION.md

**Effect:**
- INIT-5.3.x (Burn-In) P1+P2 gate: SATISFIED
- P5-B (UTV2-1150–1151) eligible for activation review

---

## Program 3 Certification Declaration

**PROGRAM 3 CERTIFIED**
Date: 2026-06-01
Authority: PM (griffadavi)

Program 3 = INIT-3.x Decision Integrity (POST_CERT Stage 4):
UTV2-1112–1131. UTV2-1115 formally canceled (retired/superseded, not a waiver).

All 19 active issues truth-check PASS. No waivers. Recovery commit: 7cc4ffe4.
Full basis: docs/06_status/programs/PROGRAM_3_CERTIFICATION.md

**Effect:**
- P1–P4 certified gate for INIT-5.x: P3 condition SATISFIED
- Combined with P4 certified (2026-06-01): P1–P4 certification gate SATISFIED
- P5-A (UTV2-1147–1149) eligible for activation review immediately
- P5-C (UTV2-1144–1146) remains frozen pending M10 Path A decision
- Program 3 certification topology: untouched — no mutations to certified artifacts
