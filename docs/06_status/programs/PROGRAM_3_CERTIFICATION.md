# Program 3 Certification Audit

**Status:** DRAFT — PM_INPUT_REQUIRED  
**Produced:** 2026-06-01  
**Authority:** PM (griffadavi)  
**Governs:** INIT-3.x Decision Integrity (POST_CERT Stage 4)  
**CERT_BOARD reference:** "POST_CERT Stage 4 (INIT-3.x / Program 3): complete (UTV2-1112–1131, all merged and truth-checked)"  
**Required by:** INIT-5.x FROZEN gate ("P1–P4 certified")

---

## 1. Program Identification

**Program 3 = INIT-3.x — Decision Integrity**

Stage 4 in the constitutional sequence. These issues implement decision integrity
guarantees: feature vector fidelity, model versioning, inference integrity, and portfolio
exposure management.

Issue range: UTV2-1112–1131 (excluding UTV2-1115, see §3)

---

## 2. Complete Issue Inventory

### INIT-3.1.x — Feature Vector and Data Integrity

| Issue | INIT | Title | Status | Merge | TC Last | TC Verdict |
|---|---|---|---|---|---|---|
| UTV2-1112 | 3.1.1 | FeatureVector Entity and Schema Registry | done | — | pass | PASS ✅ |
| UTV2-1113 | 3.1.2 | Future-Leakage Detector | done | — | pass | PASS ✅ |
| UTV2-1114 | 3.1.3 | Imputation Removal | merged | — | pass | PASS ✅ |
| UTV2-1115 | 3.1.4 | Feature Extractor Integration or Retirement | **NO MANIFEST** | — | — | **MISSING** |
| UTV2-1116 | 3.2.1 | Immutable ModelVersion with Artifact SHA | done | — | pass | PASS ✅ |

### INIT-3.2.x — Model Versioning and Inference Integrity

| Issue | INIT | Title | Status | Merge | TC Last | TC Verdict |
|---|---|---|---|---|---|---|
| UTV2-1117 | 3.2.2 | SHA Verification at Inference | done | — | pass | PASS ✅ |
| UTV2-1118 | 3.2.3 | Real Shadow Inference | done | — | pass | PASS ✅ |
| UTV2-1119 | 3.2.4 | Rollback Runtime | done | — | pass | PASS ✅ |

### INIT-3.3.x — Breach and Deployment State

| Issue | INIT | Title | Status | Merge | TC Last | TC Verdict |
|---|---|---|---|---|---|---|
| UTV2-1120 | 3.3.1 | Breach-to-Deployment-State Wiring | done | — | pass | PASS ✅ |
| UTV2-1121 | 3.3.2 | Shadow-to-Active Calibration Gate | done | — | pass | PASS ✅ |
| UTV2-1122 | 3.3.3 | Cohort-Level Holds | done | — | pass | PASS ✅ |
| UTV2-1123 | 3.3.4 | Advisory-Path Removal | done | — | pass | PASS ✅ |

### INIT-3.4.x — Decision Records and Edge Integrity

| Issue | INIT | Title | Status | Merge | TC Last | TC Verdict |
|---|---|---|---|---|---|---|
| UTV2-1124 | 3.4.1 | Immutable DecisionRecord | done | — | pass | PASS ✅ |
| UTV2-1125 | 3.4.2 | Edge-Price Freshness Enforcement | done | PR #925 | fail | **FAIL** (L5,P3,C4) |
| UTV2-1126 | 3.4.3 | Negative-EV Rejection Routing | done | PR #926 | fail | **FAIL** (C6,P6,P7,P9,P10,R1,R2,R3) |
| UTV2-1127 | 3.4.4 | forcePromote to Exception Runtime | done | PR #927 | fail | **FAIL** (R1,R2) |

### INIT-3.5.x — Portfolio Exposure Management

| Issue | INIT | Title | Status | Merge | TC Last | TC Verdict |
|---|---|---|---|---|---|---|
| UTV2-1128 | 3.5.1 | Central PortfolioExposure Store | done | PR #928 | NONE | — |
| UTV2-1129 | 3.5.2 | Serializable Exposure Consistency | done | PR #929 | NONE | — |
| UTV2-1130 | 3.5.3 | Drawdown Monitor and Atomic Halt | done | PR #930 | NONE | — |
| UTV2-1131 | 3.5.4 | Concentration Hard Blocks | done | PR #931 | NONE | — |

---

## 3. Truth-Check Classification

### Clean PASS (12 issues) — certified basis
UTV2-1112, 1113, 1114, 1116, 1117, 1118, 1119, 1120, 1121, 1122, 1123, 1124

All 12 have proof bundles on disk and passing truth-check verdicts.

### Genuine FAIL — No Exception, No Pass (3 issues — BLOCKERS)

| Issue | Failure Codes | Pattern |
|---|---|---|
| UTV2-1125 | L5 (lint), P3 (proof SHA), C4 (CI) | Proof SHA mismatch or incomplete at lane close |
| UTV2-1126 | C6, P6, P7, P9, P10, R1, R2, R3 | Proof file incompleteness at lane close |
| UTV2-1127 | R1, R2 | R-level proof artifacts missing |

None of these have a G4 exception note. None achieved a pass verdict. All were
closed 2026-05-30 during the P1 certification sprint.

Evidence.json is present for all three with merge SHA binding. Proof files exist:
- UTV2-1125: evidence.json, verification.md
- UTV2-1126: evidence.json only
- UTV2-1127: evidence.json only

### No TC Recorded (4 issues — BLOCKERS)

UTV2-1128, 1129, 1130, 1131 — all closed 2026-05-30T04:43–05:35 with empty
`truth_check_history`. All have proof dirs with evidence.json. All are in main.

These were closed on the P1 cert day without TC runs.

### Missing — No Manifest, No Proof, Not in Git (1 issue — PM ruling required)

**UTV2-1115 — INIT-3.1.4 — Feature Extractor Integration or Retirement**

- No lane manifest in `docs/06_status/lanes/`
- No proof directory in `docs/06_status/proof/`
- No commits in git referencing UTV2-1115
- Title includes "or Retirement" — strongly suggests the Retirement path was chosen
- Feature extractors exist in codebase (`packages/domain/src/features/`) — these were NOT retired

**PM must rule:** Was UTV2-1115 formally cancelled/retired? If so, this must be documented
as a PM cancellation decision for the certification to be valid.

---

## 4. Certification Blockers

**The following 8 conditions must be resolved before P3 can be declared certified:**

### Blocker B3-1 — UTV2-1125 Unresolved Truth-Check Failure
Failures: L5, P3, C4. Options: (a) `pnpm ops:truth-check UTV2-1125` on merge SHA `992a7c8c`, or (b) PM waiver.

### Blocker B3-2 — UTV2-1126 Unresolved Truth-Check Failure
Failures: C6, P6, P7, P9, P10, R1, R2, R3. Options: (a) `pnpm ops:truth-check UTV2-1126` on merge SHA `4a65550d`, or (b) PM waiver.

### Blocker B3-3 — UTV2-1127 Unresolved Truth-Check Failure
Failures: R1, R2. Options: (a) `pnpm ops:truth-check UTV2-1127` on merge SHA `5403f51a`, or (b) PM waiver.

### Blocker B3-4 — UTV2-1128 No Truth-Check Recorded
No TC run. Options: (a) `pnpm ops:truth-check UTV2-1128` on merge SHA `0d5335e7`, or (b) PM pre-cert waiver.

### Blocker B3-5 — UTV2-1129 No Truth-Check Recorded
Options: (a) `pnpm ops:truth-check UTV2-1129` on merge SHA `2c8bfd09`, or (b) PM waiver.

### Blocker B3-6 — UTV2-1130 No Truth-Check Recorded
Options: (a) `pnpm ops:truth-check UTV2-1130` on merge SHA `499d1453`, or (b) PM waiver.

### Blocker B3-7 — UTV2-1131 No Truth-Check Recorded
Options: (a) `pnpm ops:truth-check UTV2-1131` on merge SHA `77b25d7e`, or (b) PM waiver.

### Blocker B3-8 — UTV2-1115 Status Unknown (cancelled/retired?)
PM must issue a formal cancellation/retirement decision. Required text:
> "UTV2-1115 (INIT-3.1.4) is formally cancelled. The 'Retirement' path was chosen.
> Feature extractors in packages/domain/src/features/ are retained as-is. No merge required."

---

## 5. CERT_BOARD Discrepancy Notice

The CERT_BOARD.md (`docs/06_status/CERT_BOARD.md`) states:
> "POST_CERT Stage 4 (INIT-3.x / Program 3): complete (UTV2-1112–1131, all merged and truth-checked)"

This statement is inaccurate on two counts:
1. UTV2-1115 has no manifest, proof, or git commits — it is not "merged"
2. UTV2-1125–1127 have fail TCs (not passing); UTV2-1128–1131 have no TCs

The CERT_BOARD was authored on 2026-05-30 using "truth-checked" to mean "processed
through the close workflow" — not "TC verdict = pass." This audit establishes the precise state.

When P3 is formally certified, update CERT_BOARD.md §Effect to add a P3 certification declaration.

---

## 6. Draft PM Certification Declaration

**STATUS: CANNOT ISSUE — 8 blockers unresolved. Text below is the certification declaration
template to be issued AFTER all blockers are resolved.**

---

**PROGRAM 3 CERTIFIED** *(PENDING — do not activate)*  
Date: [PM to fill after blocker resolution]  
Authority: PM (griffadavi)

### Certification Basis

**INIT-3.1.x to 3.4.x (12 clean PASS issues):**
UTV2-1112, 1113, 1114, 1116, 1117, 1118, 1119, 1120, 1121, 1122, 1123, 1124 — all pass

**INIT-3.4.x (3 issues resolved by TC or waiver):**
UTV2-1125, 1126, 1127 — [resolved by path A or B]

**INIT-3.5.x (4 issues resolved by TC or waiver):**
UTV2-1128, 1129, 1130, 1131 — [resolved by path A or B]

**UTV2-1115 — Cancelled/Retired per PM decision [date]**

### Effect (when certified)
- "P1–P4 certified" gate for INIT-5.x: P3 condition SATISFIED
- Stage 4 formally closed

---

## 7. PM Actions Required

| Blocker | Merge SHA | Recommended Action |
|---|---|---|
| B3-1 (UTV2-1125) | 992a7c8c | Run TC or issue waiver |
| B3-2 (UTV2-1126) | 4a65550d | Run TC or issue waiver (proof-incompleteness failures) |
| B3-3 (UTV2-1127) | 5403f51a | Run TC or issue waiver (R1/R2 only) |
| B3-4 (UTV2-1128) | 0d5335e7 | Run TC or issue pre-cert waiver |
| B3-5 (UTV2-1129) | 2c8bfd09 | Run TC or issue pre-cert waiver |
| B3-6 (UTV2-1130) | 499d1453 | Run TC or issue pre-cert waiver |
| B3-7 (UTV2-1131) | 77b25d7e | Run TC or issue pre-cert waiver |
| B3-8 (UTV2-1115) | N/A | Issue PM cancellation decision |

**PM Waiver format (append below §7 for each waiver granted):**

> **WAIVER/DECISION granted by PM (griffadavi) on [date]:** UTV2-[id] — [waiver/cancellation text]
> **Rationale:** [specific justification]
