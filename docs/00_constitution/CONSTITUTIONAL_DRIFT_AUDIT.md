# Constitutional Drift Audit

> SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001 · 2026-06-02 · HEAD `a0614837`.
> For each constitutional area: **Implemented / Partially Implemented / Missing / Bypassed / Superseded.** Drift = where implementation reality diverges from constitutional doctrine. Reports gaps; changes no doctrine, no certification status.

## Drift classification — the 19 capability layers

| Layer | Classification | Drift description |
|---|---|---|
| 4.1 Data Acquisition | **PARTIALLY IMPLEMENTED (runtime drift)** | Code (raw capture, fail-closed secrets) exists, but **production ingestion is dark ~11.7d** — the live runtime violates 4.1's "no silent empty cycles" invariant in *operation* while satisfying it in *code*. Drift is operational, not doctrinal. |
| 4.2 Canonical Data Truth | **IMPLEMENTED** | Matches doctrine: raw payloads + immutable snapshots + PIT reconstruction + derived-projection demotion. Live-verified. No drift. |
| 4.3 Feature Engineering | **PARTIALLY IMPLEMENTED** | Feature modules exist but are **not wired into edge** and there is no enforced future-leakage detector / schema registry gate. Doctrine (4.3 invariants) is aspirational here. |
| 4.4 Modeling & Prediction | **PARTIALLY IMPLEMENTED** | ModelVersion + artifact_sha immutability exist; but the "model" is a market-consensus echo (`candidate-scoring-service.ts:261` passes `p_market_devig` as both inputs) — drift from 4.4's intent of a real reproducible prediction artifact. |
| 4.5 Calibration & Model Governance | **PARTIALLY IMPLEMENTED (aspirational)** | Calibration math is sound but **advisory** — there are no realized outcomes to calibrate against, so the "breach must block deployment" invariant is unexercised. Doctrine present, enforcement aspirational. |
| 4.6 Edge Detection | **PARTIALLY IMPLEMENTED** | Freshness/neg-EV rejection real; but edge is **structurally bounded to ±~0.04 of market consensus** — drift from 4.6's intent of genuine +EV detection. |
| 4.7 Risk Management | **IMPLEMENTED** | Deterministic risk score, breach blocks, circuit breaker. Matches doctrine. |
| 4.8 Portfolio & Exposure | **IMPLEMENTED** | Concentration/correlation/drawdown hard-blocks, central exposure. Matches doctrine. |
| 4.9 Decision Engine | **IMPLEMENTED** | Immutable DecisionRecord, governed exceptions, replay. Matches doctrine. |
| 4.10 Execution & Distribution | **PARTIALLY IMPLEMENTED (runtime drift)** | Code is doctrine-complete (idempotent delivery, exception-gated recovery); **runtime has 191 dead-letters + SLO breach** — operational drift from 4.10's delivery guarantee. |
| 4.11 Settlement & Outcome | **IMPLEMENTED** | Immutable settlement + dual-auth corrections, live-verified. Matches doctrine. |
| 4.12 Performance Evaluation | **PARTIALLY IMPLEMENTED** | CLV/ROI compute is syndicate-grade; **no realized results** (UTV2-736 149/149 blocked). 4.12's "performance claims require reproducible evidence" is met by *absence* (nothing claimed) — but the layer's purpose is unfulfilled. |
| 4.13 Runtime Integrity | **IMPLEMENTED** | Invariant registry + engine + quarantine + replay evaluation. Matches doctrine. |
| 4.14 Observability | **PARTIALLY IMPLEMENTED** | Health/freshness/alerts exist and correctly report RED — but **nobody acts on them** and Loki is undeployed. 4.14's "critical failures must be observable" is met; "must be acted upon" is the operational gap. |
| 4.15 Governance & Certification | **IMPLEMENTED** | The crown jewel — certification entity, lifecycle, revocation, dependent gates. Matches doctrine. (Runtime cert-check UNPROVEN on env, not drift.) |
| 4.16 Human Operations | **IMPLEMENTED** | Authority matrix, PM gates, escalation, runbooks. Minor: no audit_log operator UI. |
| 4.17 Capital Operations & Treasury | **MISSING (intentionally frozen)** | No capital ledger / treasury runtime. This is **correct constitutional posture** — §4.17 requires certification + burn-in before capital; both absent, so the layer is properly frozen (P5-C). Missing-by-design, not drift. |
| 4.18 Market Adversarial Intelligence | **PARTIALLY IMPLEMENTED** | Detectors + escalation merged (P5-A); survivability/burn-in evidence absent. 4.18's "survivability proven before scaling" not yet met. |
| 4.19 Economic Attribution | **PARTIALLY IMPLEMENTED** | Attribution engine + cohorts + edge-decay code merged (P4); no realized attribution data. 4.19's "profit alone is not proof of edge" is honored by having *no* edge claim. |

## Which constitutional areas became enforcement CODE
Real, mechanical enforcement (the constitution made executable): §2.2–2.5, 2.8, 2.12, 2.14; layers 4.2, 4.7, 4.8, 4.9, 4.11, 4.13, 4.15, 4.16; DB triggers (FSM, settlement, audit_log); authority matrix; dual-auth; replay isolation; dependent-gate certification. **This is the strongest band — governance, truth, and lifecycle are code, not prose.**

## Which constitutional areas became LINEAR processes
Certification *records and policy* live as Linear documents (operational tracking, subordinate per hierarchy): `PROGRAM_1_FROZEN_SURFACE`, `PROGRAM_1_CERTIFICATION_GATE`, `PROGRAM_2_*`, `CONSTITUTIONAL_DEBT_REGISTER`, `CERTIFICATION_OPERATIONS_RUNBOOK`. Board execution runtime (§20) is realized as the Linear board + lane manifests. **Drift risk:** these Linear docs are the *only* home of P1 certification (no repo cert doc for P1), and they have **not been updated to authorize P3+** (see below).

## Which constitutional areas remain ASPIRATIONAL
Layers whose doctrine is written and partially scaffolded but not yet fulfilled: 4.3 (feature→edge wiring), 4.5 (enforced calibration), 4.6 (real edge), 4.12 (realized performance), 4.19 (realized attribution), 4.18 (survivability). Common root: **all depend on a real model signal + settled-outcome data that does not yet exist.** §10 proof framework is aspirational where the proof gate is string-bound (C-1).

## Which constitutional areas have DRIFTED (doctrine vs reality conflict)

> **PM rulings (2026-06-02, SPRINT-CONSTITUTIONAL-CONVERGENCE-002):** **D-CONST-1 = `PM_RATIFIED`** (§18.3 numbering canonical) and **D-CONST-2 = `PM_RATIFIED`** (P1 ACTIVE_CERTIFIED · P2 ACTIVE_CERTIFIED · P3 ACTIVE_NOT_CERTIFIED · P4 CONDITIONAL_NOT_CERTIFIED · P5 FROZEN_NOT_CERTIFIED). D-CONST-3..8 remain **OPEN**. Canonical state: `CANONICAL_PROGRAM_STATE.md`; ledger: `CERTIFICATION_GAP_REGISTER.md`. No certification was advanced by these rulings.

| Drift | Constitution says | Reality | Severity |
|---|---|---|---|
| **D-CONST-1 — Program numbering** | §18.3: **P2 = Governance, P3 = Decision Integrity, P4 = Execution & Economic, P5 = Institutional** | Repo `PROGRAM_2_CERTIFICATION.md` declares "Program 2 = WS-1.x" and back-derives the number (`:28`). | **HIGH** — repo cert docs are **constitutionally mislabeled.** The constitution is the tie-breaker; per §18.3 the doc the repo calls "P2 cert (WS-1.x)" is actually **Program 1** work. |
| **D-CONST-2 — P3+ activation** | §20.6: stage activation requires proof of prerequisite certification; Linear `PROGRAM_1_FROZEN_SURFACE` (rank-4 op record) says "Program 3+ frozen, no expansion authorized" | Repo docs claim P3 + P4 "certified 2026-06-01"; **no Linear doc lifts the P3+ freeze** | **HIGH** — certification claim outruns the recorded activation authority. |
| **D-CONST-3 — Missing P1/P4 repo cert docs** | §10 cert classes + §18.3 programs imply per-program certification record | P1 cert exists **only in Linear**; P4 cert exists **only as scattered lane-manifest annotations** — no repo doc for either | **MEDIUM** — asymmetric, non-canonical cert record. |
| **D-CONST-4 — Proof Over Narrative (2.11/§10)** | proof must be machine-readable + executable | `t1-proof-gate` greps the literal string `"test:db"`; DB-trigger proofs skip silently w/o service key | **HIGH** — a §22 anti-pattern ("post-merge proof skipped" / advisory-as-enforcement) is live in the proof gate itself. |
| **D-CONST-5 — Edge as echo (4.6/4.19)** | edge must be genuine +EV; "profit alone is not proof of edge" | edge = market-consensus echo; zero profitability evidence | **MEDIUM** (mission, not safety) — honestly fails-closed (no false edge claim), but the layer's purpose is undelivered. |
| **D-CONST-6 — Ingestion freshness (4.1/4.14/§22)** | "daemon looping empty while marked healthy" is a named anti-pattern | live ingestion ~11.7d stale | **HIGH (operational)** — the exact anti-pattern §22 prohibits is occurring in production. |
| **D-CONST-7 — `database.types.ts` drift (§7)** | domain model entities must be canonical | `execution_intents` + `settlement_corrections` live but absent from generated types | **MEDIUM** |
| **D-CONST-8 — Doc says fail-open, code fail-closed (§8.4)** | prod repos must fail closed | ~~`packages/db/CLAUDE.md` + `packages/contracts/CLAUDE.md` claim "fail-open"; code is fail-closed~~ **RESOLVED** by SPRINT-D-CONST-8-FAIL-CLOSED-DOC-RECONCILIATION (2026-06-04, UTV2-1199). Documentation corrected; no code changed; code was already fail-closed. | **RESOLVED** — doc-only drift eliminated. |

## Special focus verdict — capability layers 4.1–4.19
As predicted by the sprint spec, **the capability layers are the largest source of drift** — but the drift is **asymmetric and informative**:
- **Governance/truth/lifecycle layers (4.2, 4.7–4.9, 4.11, 4.13, 4.15, 4.16) are genuinely implemented** — the constitution succeeded at making safety executable.
- **Intelligence/economic layers (4.3, 4.4, 4.5, 4.6, 4.12, 4.19) are scaffolded but aspirational** — plumbing without signal/data.
- **Runtime-operational drift (4.1, 4.10, 4.14)** — code is doctrine-complete but production is degraded (stale ingestion, dead-letters, unacted alerts).
- **Capital layer (4.17) is correctly frozen.**

**Net:** Unit Talk has converged the *constitutional safety surface* (it cannot silently lie) far more than the *constitutional intelligence surface* (it cannot yet prove it wins). That is the central, honest drift finding.
