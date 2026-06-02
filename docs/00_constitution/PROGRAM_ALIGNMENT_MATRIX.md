# Program Alignment Matrix

> SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001 · 2026-06-02 · HEAD `a0614837`.
> Maps Programs 1–5 (per **constitution §18.3 — the authoritative numbering**) to capability layers, issues, workstreams, certifications, and runtime components. Based on **repo evidence**, not Linear assumptions. Determines what each Program *actually means today.* Changes no certification status.

## PM-ratified activation state (2026-06-02 — D-CONST-2 `PM_RATIFIED`)

| Program | Activation status (canonical) |
|---|---|
| P1 Truth Convergence | **ACTIVE_CERTIFIED** |
| P2 Governance Convergence | **ACTIVE_CERTIFIED** |
| P3 Decision Integrity | **ACTIVE_NOT_CERTIFIED** |
| P4 Execution & Economic Truth | **CONDITIONAL_NOT_CERTIFIED** |
| P5 Institutional Runtime | **FROZEN_NOT_CERTIFIED** |

> Authoritative detail in [`CANONICAL_PROGRAM_STATE.md`](./CANONICAL_PROGRAM_STATE.md). This matrix's per-program "certification" prose below is **historical analysis**; where it differs from the table above, the table (and CANONICAL_PROGRAM_STATE) governs. No certification was advanced.

## Authoritative program definitions (§18.3)

| Program | Constitutional name | Maturity stage (§16) | Capability layers | Convergence target |
|---|---|---|---|---|
| **P1** | Truth Convergence | Stage 1–2 (Immutable Truth + Runtime Integrity) | 4.1, 4.2, 4.13 + Replay domain (§5.3.6) | raw payloads, odds snapshots, PIT reconstruction, freshness honesty, replay substrate, invariant runtime |
| **P2** | Governance Convergence | Stage 3 (Governance Runtime) | 4.15, 4.16 | certification runtime, proof runtime, governance exceptions, authority enforcement |
| **P3** | Decision Integrity Convergence | Stage 4 (Decision Integrity) | 4.3, 4.4, 4.5, 4.8, 4.9 | feature gov, model gov, calibration enforcement, decision immutability, portfolio runtime |
| **P4** | Execution & Economic Truth Convergence | Stage 5 (Execution & Economic Truth) | 4.10, 4.11, 4.12, 4.19 | execution runtime, settlement hardening, CLV truth, attribution |
| **P5** | Institutional Runtime Convergence | Stage 6 (Institutional Runtime) | 4.17, 4.18 + burn-in | treasury, adversarial intelligence, burn-in, capital scaling |

## P1 — Truth Convergence

| Dimension | Reality (repo evidence) |
|---|---|
| **Issues** | UTV2-1083 (reversible migration), 1088 (invariant registry substrate), 1084 (raw payload + hashing), 1085 (immutable odds snapshots), 1086 (snapshot cutover + PIT), 1087 (freshness + auto-quarantine), 1091 (isolated replay harness), 1089 (invariant engine), 1093 (replay validator un-stub), 1092 (divergence engine), 1094 (prod/replay integration), 1095 (30-day replay driver) — **all merged** (§21 sequence) |
| **Runtime components** | `apps/ingestor`, `raw_payloads`/`odds_snapshots` tables, `packages/verification/.../full-pipeline-replay.ts`, `packages/invariants/engine.ts` + `registry/invariant-registry.json` |
| **Certification** | **CERTIFIED** — Linear `PROGRAM_1_FROZEN_SURFACE` (eval 2026-05-27, SHA `9600938…`), proof `docs/06_status/proof/PROGRAM1/replay-reproducibility-…json`. **No repo cert doc** (D-CONST-3). Auto-degrade deadline 2026-08-25 (proof_lineage + freshness). |
| **What P1 actually means today** | The truth + replay substrate is real and certified **in code**; but **live ingestion is dark (~11.7d)**, so P1's *operational* freshness guarantee is currently violated even though the certification (frozen 2026-05-27) predates the staleness. Re-cert deadline looms. |

## P2 — Governance Convergence

| Dimension | Reality |
|---|---|
| **Issues** | UTV2-1096 (certification_records), 1097 (CertificationLifecycleManager), 1107 (picks FSM trigger), 1108 (authority matrix), 1109 (dual-auth), 1110 (approval expiration), 1111 (governance rollback), 1177 (atomic cert propagation), 1181 (cross-domain), 1182 (dual-auth expiry boundary), 1183 (terminal rollback) |
| **Workstreams** | WS-2.1 Certification Runtime (Linear project home of all governance docs) |
| **Runtime components** | `packages/contracts/{operator-role,dual-auth,approval-expiration,governance-rollback}.ts`, `packages/invariants/src/certification/*`, `apps/worker/certification-runtime.ts`, DB: `certification_records`, FSM trigger |
| **Certification** | Linear `PROGRAM_2_MINIMUM_ACTIVATION_GATE` + `PROGRAM_2_EXECUTION_POLICY` (activatable under P1 freeze). Repo `PROGRAM_2_CERTIFICATION.md` exists **but is constitutionally mislabeled "P2 = WS-1.x"** (D-CONST-1). |
| **What P2 actually means today** | Governance runtime is the **strongest implemented program** — 229 live constitutional tests pass. The naming drift (D-CONST-1) and the UTV2-1084 TC-FAIL in the cert inventory (D-7) are the open issues, not the code. |

## P3 — Decision Integrity Convergence

| Dimension | Reality |
|---|---|
| **Issues** | INIT-3.x chain (e.g. UTV2-1118 real shadow inference, 1119…); feature/model/calibration/decision/portfolio work |
| **Runtime components** | `packages/domain/src/{features,models,probability,risk,portfolio,strategy}/*`, `promotion.ts`, `candidate-scoring-service.ts`, `model_registry` |
| **Certification** | Repo `PROGRAM_3_CERTIFICATION.md` claims certified 2026-06-01. **No Linear authorization lifts the P3+ freeze** (D-CONST-2). |
| **What P3 actually means today** | Decision *immutability + portfolio + risk* (4.8, 4.9) are genuinely implemented; **feature/model/calibration (4.3–4.5) are scaffolded but aspirational** (not wired to a real edge). P3 is *half real* — the governance half landed, the intelligence half is plumbing. |

## P4 — Execution & Economic Truth Convergence

| Dimension | Reality |
|---|---|
| **Issues** | UTV2-1132 (execution_intents), 1134 (exception-gated dead-letter recovery), 1135 (updatePayload removal), 1136 (settlement immutability trigger), 1137 (dual-auth corrections), 1141 (attribution engine), 1142 (reproducible cohorts), 1143 (edge decay detector) |
| **Runtime components** | `apps/worker` (outbox/delivery/recovery), `execution_intents`/`settlement_records`/`settlement_corrections` tables, `clv-service.ts`, attribution/cohort domain modules |
| **Certification** | **No `PROGRAM_4_CERTIFICATION.md` anywhere** (repo or Linear) — only 3 `chore(program-4)` lane-manifest annotation commits + HEAD `55bd0bd7` (D-CONST-3). Weakest cert basis of any "certified" program. |
| **What P4 actually means today** | Execution + settlement (4.10, 4.11) are doctrine-complete in code (settlement live-verified); **economic truth (4.12 CLV, 4.19 attribution) is code-only with no realized data** (UTV2-736 149/149 blocked). Runtime delivery is degraded (191 dead-letters). P4 = "execution real, economics unproven." |

## P5 — Institutional Runtime Convergence

| Sub-program | Issues | Status | Layer |
|---|---|---|---|
| **P5-A Adversarial** | UTV2-1147 (independent data path), 1148 (anomaly/manipulation detectors), 1149 (escalation wiring) | **Merged (code done) 2026-06-01**; not burn-in/survivability proven | 4.18 |
| **P5-B Burn-In** | UTV2-1150 (harness), 1151 (execution) | Harness merged; **execution never run — zero passing snapshots** | burn-in (Stage 6) |
| **P5-C Treasury** | UTV2-1144–1146 | **FROZEN** (M10 Path A blocked) — correct per §4.17 (no cert+burn-in) | 4.17 |
| **P5-D Capital Scaling** | UTV2-1152–1154 | **FROZEN** (needs P5-B + P5-C) — correct per §4.17 | 4.17 |
| **Certification** | — | No P5 cert; `PROGRAM_5_ACTIVATION.md` is an activation packet, not a certification | — |
| **What P5 means today** | Adversarial detectors exist; **burn-in (the gate for everything institutional) has never passed**; capital/treasury correctly frozen. P5 is gated on P1-runtime restoration + first burn-in PASS. |

## Cross-program reconciliation (the important conclusions)
1. **The constitution resolves the numbering dispute.** Per §18.3, the Linear initiative scheme (P2=Governance, P3=Decision, P4=Execution/Economic) is correct; the repo cert docs' "P2=WS-1.x" is **drift to fix** (D-CONST-1), not an alternative truth.
2. **Certification records are asymmetric and partly non-canonical:** P1 lives only in Linear, P2/P3 have repo docs (P2 mislabeled), P4 has only manifest annotations, P5 has none. Per §10 every program should have a SHA-bound cert record.
3. **"P1–P4 certified" is not deterministically verifiable today** — and §20.6 forbids stage activation without proof of prerequisite certification. **Capital (P5-C/P5-D) must stay frozen** until D-CONST-1/2/3 close and burn-in passes. This matches the existing freeze and the constitution's §4.17.
4. **Program convergence is real for safety (P1-P2, parts of P4), aspirational for intelligence (P3 feature/model, P4 economic).**
