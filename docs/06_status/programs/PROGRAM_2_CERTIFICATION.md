# Program 2 Certification Audit

**Status:** DRAFT — PM_INPUT_REQUIRED  
**Produced:** 2026-06-01  
**Authority:** PM (griffadavi)  
**Governs:** WS-1.x Constitutional Foundation Layer (INIT-1.x)  
**Required by:** INIT-5.3.x Burn-In activation gate ("P1+P2 certified")

---

## 1. Program Identification

**Program 2 = WS-1.x Constitutional Foundation Layer (INIT-1.x)**

This program encompasses the three Stage 1/2 workstreams that establish the constitutional substrate
for all downstream programs:

| Workstream | Name | Stage |
|---|---|---|
| WS-1.1 | Immutable Market Truth | Stage 1 |
| WS-1.2 | Canonical Replay Infrastructure | Stage 2 |
| WS-1.3 | Runtime Invariant Enforcement | Stage 2 |

These were dispatched as Stage 2 work per `docs/06_status/STAGE2_ACTIVATION_CHECKLIST.md`.
The CERT_BOARD references "P1+P2" as a gate for INIT-5.3.x (Burn-In), establishing Program 2
as the WS-1.x layer.

---

## 2. Complete Issue Inventory

### WS-1.1 — Immutable Market Truth

| Issue | INIT | Title | Status | Merge | TC Last | TC Verdict |
|---|---|---|---|---|---|---|
| UTV2-1083 | 1.1.0 | Reversible Migration Capability | merged | PR #829 | NONE | — |
| UTV2-1084 | 1.1.1 | Raw Provider Payload Substrate | done | PR #831 | 1 entry | **FAIL** (C6,P6,P7,P9,P10,R1,R2,R3) |
| UTV2-1085 | 1.1.2 | Immutable OddsSnapshot Table and Triggers | done | PR #832 | pass | PASS ✅ |
| UTV2-1086 | 1.1.3 | Snapshot Cutover and Point-in-Time Reconstruction | done | PR #842 | NONE | — |
| UTV2-1087 | 1.1.4 | Freshness Honesty and Provider Auto-Quarantine | done | PR #843 | 2 entries | **FAIL** (G3,P6,S1 → G3) |

### WS-1.2 — Canonical Replay Infrastructure

| Issue | INIT | Title | Status | Merge | TC Last | TC Verdict |
|---|---|---|---|---|---|---|
| UTV2-1091 | 1.2.1 | Isolated Full-Pipeline Replay Harness | done | PR #847 | pass | PASS ✅ |
| UTV2-1093 | 1.2.2 | Replay Validator Un-Stubbing | done | PR #848 | pass | PASS ✅ |
| UTV2-1092 | 1.2.3 | Replay Divergence Engine | done | PR #849 | pass | PASS ✅ |
| UTV2-1095 | 1.2.4 | 30-Day Replay Driver + Latent-Divergence Remediation | done | PR #866 | fail (G4) | **G4 exception** |

### WS-1.3 — Runtime Invariant Enforcement

| Issue | INIT | Title | Status | Merge | TC Last | TC Verdict |
|---|---|---|---|---|---|---|
| UTV2-1088 | 1.3.1 | Machine-Readable Invariant Registry Substrate | merged | PR #830 | NONE | — |
| UTV2-1089 | 1.3.2 | InvariantEngine Runtime Evaluable Set | done | PR #846 | pass | PASS ✅ |
| UTV2-1090 | 1.3.3 | Automatic Quarantine and Escalation | done | PR #856 | fail (G4) | **G4 exception** |
| UTV2-1094 | 1.3.4 | Production/Replay Integration; False-Confidence Test Retirement | done | PR #864 | fail (G4) | **G4 exception** |

---

## 3. Truth-Check Classification

### Clean PASS (5 issues)
| Issue | Verdict |
|---|---|
| UTV2-1085 | pass |
| UTV2-1089 | pass |
| UTV2-1091 | pass |
| UTV2-1092 | pass |
| UTV2-1093 | pass |

### G4 Systematic Exception — PM_VERDICT:APPROVED (3 issues)
The G4 failure pattern (squash merge SHA has `verify:cancelled`) is an established systematic
exception. Lane closed manually per documented exception. All three are status:done in main.

| Issue | Failure | Exception Note |
|---|---|---|
| UTV2-1090 | G4 | "PM_VERDICT:APPROVED is the blocking authority. Lane closed manually per established exception." |
| UTV2-1094 | G4 | Same pattern |
| UTV2-1095 | G4 | Same pattern |

### No TC Recorded — Pre-System Merges (3 issues)
These issues were merged to main before the truth-check system was fully operational.
All have proof bundles on disk. No TC run was recorded.

| Issue | Proof Bundle |
|---|---|
| UTV2-1083 | proof.md, evidence.json, diff-summary.md, verification.md |
| UTV2-1086 | evidence.json, verification-log.md, verification.md |
| UTV2-1088 | proof.md, evidence.json, diff-summary.md, verification.md |

### Genuine FAIL — No Exception, No Pass (2 issues — BLOCKERS)
These issues have truth-check failures that do NOT fit the G4 systematic exception pattern.
No PM_VERDICT:APPROVED waiver is recorded. These are the blocking items for P2 certification.

| Issue | Failure Codes | Explanation |
|---|---|---|
| UTV2-1084 | C6, P6, P7, P9, P10, R1, R2, R3 | Proof file incompleteness pattern at lane close — no exception note, no pass |
| UTV2-1087 | G3, P6, S1 (then G3 alone) | Two separate runs both failed; no exception note, no pass |

---

## 4. Proof Bundle Status

All 13 Program 2 issues have proof directories on disk at
`docs/06_status/proof/UTV2-{id}/`.

All issues except UTV2-1083, UTV2-1088 (status=merged, evidence.json with `set-by-ci` SHA stubs)
have evidence.json with verified_source_sha bound.

---

## 5. Certification Blockers

**The following 5 conditions must be resolved before P2 can be declared certified:**

### Blocker B2-1 — UTV2-1084 Unresolved Truth-Check Failure
- Failure codes: C6 (CI check not verified), P6 (proof verification file missing), P7 (proof verification header missing), P9 (proof runtime evidence missing), P10 (proof queries missing), R1, R2, R3
- Options: (a) run a corrected `pnpm ops:truth-check UTV2-1084` against the merge SHA to achieve pass, OR (b) PM documents a waiver with explicit justification for each failure code

### Blocker B2-2 — UTV2-1087 Unresolved Truth-Check Failure
- Failure codes: G3 (CI not green on merge SHA), P6, S1 (SHA binding issue)
- Options: (a) rerun `pnpm ops:truth-check UTV2-1087` to achieve pass, OR (b) PM documents a waiver

### Blocker B2-3 — UTV2-1083 No Truth-Check Recorded
- status=merged, no TC history. PM must either: (a) declare a no-TC waiver (pre-system merge), or (b) run `pnpm ops:truth-check UTV2-1083` against merge SHA

### Blocker B2-4 — UTV2-1086 No Truth-Check Recorded
- Same as B2-3 for UTV2-1086

### Blocker B2-5 — UTV2-1088 No Truth-Check Recorded
- Same as B2-3 for UTV2-1088. Note: UTV2-1088 has status=merged (not done) — the merge status itself may need resolution

---

## 6. Draft PM Certification Declaration

**STATUS: CANNOT ISSUE — 5 blockers unresolved. The text below is the certification declaration
template to be issued AFTER all blockers are resolved via PM waiver or TC pass.**

---

**PROGRAM 2 CERTIFIED** *(PENDING — do not activate)*  
Date: [PM to fill after blocker resolution]  
Authority: PM (griffadavi)

### Certification Basis

**WS-1.1 — Immutable Market Truth:**
| Issue | Component | Status | Merge SHA |
|---|---|---|---|
| UTV2-1083 | Reversible Migration Capability | [pending TC] | PR #829 |
| UTV2-1084 | Raw Provider Payload Substrate | [pending TC or waiver] | PR #831 |
| UTV2-1085 | Immutable OddsSnapshot Table | PASS ✅ | PR #832 |
| UTV2-1086 | Snapshot Cutover | [pending TC] | PR #842 |
| UTV2-1087 | Freshness Honesty | [pending TC or waiver] | PR #843 |

**WS-1.2 — Canonical Replay Infrastructure:**
| Issue | Component | Status |
|---|---|---|
| UTV2-1091 | Isolated Full-Pipeline Replay Harness | PASS ✅ |
| UTV2-1093 | Replay Validator Un-Stubbing | PASS ✅ |
| UTV2-1092 | Replay Divergence Engine | PASS ✅ |
| UTV2-1095 | 30-Day Replay Driver | G4 exception ✅ |

**WS-1.3 — Runtime Invariant Enforcement:**
| Issue | Component | Status |
|---|---|---|
| UTV2-1088 | Machine-Readable Invariant Registry | [pending TC] |
| UTV2-1089 | InvariantEngine Runtime Evaluable Set | PASS ✅ |
| UTV2-1090 | Automatic Quarantine and Escalation | G4 exception ✅ |
| UTV2-1094 | Production/Replay Integration | G4 exception ✅ |

### Effect (when certified)
- INIT-5.3.x (Burn-In, UTV2-1150–1151) "P1+P2" gate: SATISFIED
- Constitutional foundation topology: untouched — no mutations to certified artifacts

---

## 7. PM Actions Required

Choose one path for each blocker:

| Blocker | Path A — Run TC | Path B — PM Waiver |
|---|---|---|
| B2-1 (UTV2-1084) | `pnpm ops:truth-check UTV2-1084` → expect pass on merge SHA | PM documents waiver in this file |
| B2-2 (UTV2-1087) | `pnpm ops:truth-check UTV2-1087` → expect pass on merge SHA | PM documents waiver in this file |
| B2-3 (UTV2-1083) | `pnpm ops:truth-check UTV2-1083` | PM declares pre-system waiver |
| B2-4 (UTV2-1086) | `pnpm ops:truth-check UTV2-1086` | PM declares pre-system waiver |
| B2-5 (UTV2-1088) | `pnpm ops:truth-check UTV2-1088` + resolve merged→done status | PM declares pre-system waiver |

**PM Waiver format (append below §7 for each waiver granted):**

> **WAIVER granted by PM (griffadavi) on [date]:** UTV2-[id] truth-check failure/absence accepted.
> **Rationale:** [specific reason — pre-system merge / G3 pattern known safe / proof docs complete]
> **Failure codes waived:** [list]
