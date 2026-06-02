# Constitution Implementation Matrix

> SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001 · 2026-06-02 · HEAD `a0614837`.
> Maps every constitutional section to repo implementation, enforcement, tests, CI gates, and status. **Gaps are reported, never hidden.** Status reflects *code + proof on `main`*, not aspiration. Where runtime is degraded (e.g. ingestion dark), the **code** status and the **runtime** status are stated separately.
>
> Status legend: `IMPLEMENTED` · `PARTIALLY_IMPLEMENTED` · `NOT_IMPLEMENTED` · `UNKNOWN`.
> Evidence basis: the definitive readiness audit (`docs/06_status/readiness/UNIT-TALK-DEFINITIVE-READINESS-AUDIT/`) + 229 live constitutional tests + live Supabase queries.

## §2 Constitutional Principles

| Principle | Repo implementation | Enforcement | Tests / CI | Status |
|---|---|---|---|---|
| 2.1 Truth Before Prediction | `raw_payloads`/`odds_snapshots` (UTV2-1084/1085); edge bound to canonical snapshots | DB immutability triggers; edge fail-closed to 0 w/o market data | `lifecycle`*, data-truth tests; `live-schema-parity.yml` | **IMPLEMENTED** (code); see drift: edge is market-echo |
| 2.2 Determinism Before Automation | `IsolatedReplayStore`, deterministic replay (sorted `occurredAt`) | replay throws on prod write | `full-pipeline-replay.test.ts` (39) | **IMPLEMENTED** |
| 2.3 Fail Closed | `assert*` guards throughout; missing-secret guards | throw, not warn | `env:check`; provider provenance asserts | **IMPLEMENTED** |
| 2.4 Immutable History | settlement/audit_log immutability triggers; `Object.freeze` records | DB BEFORE UPDATE/DELETE RAISE | UTV2-1136 proof; audit_log trigger | **IMPLEMENTED** |
| 2.5 Explicit Authority | `AUTHORITY_MATRIX` (20 domains), `assertAuthority` | throws `AuthorityViolationError` | `t1-proof-utv2-1108` | **IMPLEMENTED** |
| 2.6 Replayability | replay engine + divergence | replay isolation | replay tests; `shadow-parity-required.yml` | **IMPLEMENTED** (substrate); runtime replay unproven at scale |
| 2.7 Auditability | `audit_log` (79,625 rows live), append-only | trigger-protected | live DB; `proof-auditor-gate.yml` | **IMPLEMENTED** (data); **PARTIAL** UI (no audit_log viewer) |
| 2.8 Separation of Duties | dual-auth (6 actions), executor/reviewer split | same-operator rejected | `t1-proof-utv2-1109` | **IMPLEMENTED** |
| 2.9 Human Governance | PM verdict schema; `t1-approved` label gate | merge-gate requires PM | `tier-label-check.yml`, `merge-gate.yml` | **IMPLEMENTED** |
| 2.10 Labels Are Evidence Not Truth | truth hierarchy in `CLAUDE.md`; lane manifests authoritative | doc-truth-gate | `doc-truth-gate.yml` | **IMPLEMENTED** |
| 2.11 Proof Over Narrative | proof bundles SHA-bound | proof-auditor-gate | `proof-auditor-gate.yml`, `evidence-bundle-validate.yml` | **PARTIALLY_IMPLEMENTED** — `t1-proof-gate` greps string `"test:db"` not execution (C-1) |
| 2.12 Revocable Trust | certification expiry + revocation; dependent-gate BFS | revocation propagates | `dependent-gate.test.ts`, `certification.test.ts` | **IMPLEMENTED** |
| 2.13 Adversarial Validation | adversarial detectors (UTV2-1147/1148) | escalation wiring (1149) | domain adversarial tests | **PARTIALLY_IMPLEMENTED** — merged, not burn-in proven |
| 2.14 No Self-Certification | dual-adversarial Claude↔Codex; PM label | merge-gate | `codex-return-review.yml`, `r-level-compliance-check.yml` | **IMPLEMENTED** |

## §4 Capability Layers (the 19)

| Layer | Repo implementation (primary) | Enforcement mechanism | Tests / CI gates | CODE status | RUNTIME status |
|---|---|---|---|---|---|
| **4.1 Data Acquisition** | `apps/ingestor` (`sgo-fetcher.ts`), `raw_payloads` (UTV2-1084) | missing-secret fail-closed; raw capture pre-transform | ingestor tests; `ingestor-staleness-alert.yml` | PARTIALLY_IMPLEMENTED | **RED — ingestion dark ~11.7d stale** |
| **4.2 Canonical Data Truth** | `odds_snapshots` (1085), snapshot cutover (1086), `provider_offer_current` derived | DB append-only + immutability triggers | `live-schema-parity.yml`; data-truth tests | **IMPLEMENTED** | live-verified |
| **4.3 Feature Engineering** | `packages/domain/src/features/*`, `feature-vector.ts`, `stat-distribution.ts` | schema, tested | `test:domain-features` (282) | PARTIALLY_IMPLEMENTED — not wired to edge; no leakage-detector enforced | n/a |
| **4.4 Modeling & Prediction** | `model_registry`, `ModelVersion`, artifact_sha immutability (1116), shadow inference | SHA immutability trigger (1116) | `t1-proof-utv2-1116` | PARTIALLY_IMPLEMENTED — champion is market-echo; no real artifact | n/a |
| **4.5 Calibration & Model Governance** | `probability/calibration.ts` (Brier/ECE/MCE), `calibration-gate.ts` | gate exists | analytics tests (288) | PARTIALLY_IMPLEMENTED — sound math, no outcomes to calibrate; advisory-not-enforced | n/a |
| **4.6 Edge Detection** | edge calc, price freshness, neg-EV rejection (UTV2-985), market resistance | edge→0 fail-closed; suppress < minEdge | `promotion` tests | PARTIALLY_IMPLEMENTED — mechanism real; **edge structurally = market echo** | n/a |
| **4.7 Risk Management** | `risk/kelly-sizer.ts`, `computeRiskScore`, circuit breaker | breach blocks/quarantines | risk tests | **IMPLEMENTED** | n/a |
| **4.8 Portfolio & Exposure** | `portfolio/*` concentration/correlation/drawdown, exposure store | hard-blocks, daily-loss-limit | portfolio tests | **IMPLEMENTED** | n/a |
| **4.9 Decision Engine** | `promotion.ts` (15 gates), immutable `DecisionRecord`, forcePromote exception | replay-deterministic, exception-linked | `promotion` replay tests | **IMPLEMENTED** | n/a |
| **4.10 Execution & Distribution** | `ExecutionIntent` (1132), outbox, receipts, dead-letter recovery (1134) | exactly-one DeliveryOutcome; exception-gated recovery | invariants engine; outbox tests | **IMPLEMENTED** (code) | **RED — 191 dead-letters, SLO breached** |
| **4.11 Settlement & Outcome** | `SettlementRecord`, immutability trigger (1136), dual-auth corrections (1137) | DB RAISE on UPDATE/DELETE; corrects_id additive | `t1-proof-utv2-1136/1137`; live test:db | **IMPLEMENTED** | live-verified |
| **4.12 Performance Evaluation** | `clv-service.ts`, performance cohorts (1142), ROI/CLV | verified-close hierarchy, fail-closed quarantine | analytics tests | PARTIALLY_IMPLEMENTED — compute strong; **no realized results (UTV2-736 149/149 blocked)** | n/a |
| **4.13 Runtime Integrity** | `packages/invariants` (`engine.ts`, `registry/invariant-registry.json`) | violations emitted; quarantine | `invariant-registry-gate.yml` | **IMPLEMENTED** | partial (runtime monitors firing) |
| **4.14 Observability** | `runtime:health`, `pipeline:health`, health endpoint, command-center, Loki/Kuma compose | alerts scheduled | `pipeline-health-monitor.yml`, `ops-burn-in-monitor.yml` | PARTIALLY_IMPLEMENTED — monitors correct but "firing into a void"; Loki not deployed | partial |
| **4.15 Governance & Certification** | `certification_records` (1096), state machine, dependent-gate, PM verdict | runtime cert state; revocation BFS | `certification.test.ts`, `dependent-gate.test.ts`; `proof-auditor-gate.yml` | **IMPLEMENTED** | `ops:cert-check` UNPROVEN (env) |
| **4.16 Human Operations** | authority matrix, PM verdict schema, escalation (1149), runbooks | PM gate; exception records | `executor-result-validator.yml` | **IMPLEMENTED** | PARTIAL — no audit_log UI |
| **4.17 Capital Operations & Treasury** | — none — frozen domain | frozen (`governance-rollback.ts`: `treasury`,`capital`,`scaling`) | n/a | **NOT_IMPLEMENTED** (intentionally frozen — P5-C) | frozen |
| **4.18 Market Adversarial Intelligence** | adversarial data path (1147), anomaly/manipulation detectors (1148), escalation (1149) | escalation wiring | domain adversarial tests | PARTIALLY_IMPLEMENTED — merged (P5-A); not burn-in/survivability proven | n/a |
| **4.19 Economic Attribution** | `AttributionEngine` (1141), `PerformanceCohort` (1142), edge-decay detector (1143) | reproducible cohorts | analytics tests | PARTIALLY_IMPLEMENTED — code merged (P4 INIT-4.4); **no realized attribution data** | n/a |

## §5–§20 System / governance sections

| Section | Implementation | Status |
|---|---|---|
| §5 Component Architecture (domains, boundary rules) | apps/packages boundary (domain pure, apps own side effects); `code-structure` skill + CI | **IMPLEMENTED** (boundaries enforced) |
| §6 Technical Stack | Supabase/Postgres, immutability triggers, RLS, CI gates, live DB proof, tsx | **IMPLEMENTED** |
| §7 Canonical Domain Model (21 entities) | most entities present (`DecisionRecord`, `SettlementRecord`, `ExecutionIntent`, `Certification`, `ProofBundle`, `AuditEvent`, `OddsSnapshot`, `RawPayload`…) | **PARTIALLY_IMPLEMENTED** — capital/treasury entities absent (frozen); `database.types.ts` drift (B8) |
| §8 Contracts & Interfaces | `packages/contracts/*`, typed repos, in-memory vs prod fail-closed | **IMPLEMENTED** — note: CLAUDE.md "fail-open" doc lines wrong (code is fail-closed) |
| §9 Operating Model (T1/T2/T3) | tier gates, PM verdict, adversarial review | **IMPLEMENTED** |
| §10 Proof & Certification Framework | proof bundles, 16 cert classes, lifecycle, revocation triggers | **PARTIALLY_IMPLEMENTED** — proof-gate is string-bound not execution-bound (C-1) |
| §11 Security & Trust | RLS deny-all, service-role audit, secrets fail-closed, dual-auth | **PARTIALLY_IMPLEMENTED** — 6 SECURITY DEFINER ERROR advisors + RPC grants (H5) |
| §12 Infrastructure & Topology | single-node Hetzner, rollback, health verify | **PARTIALLY_IMPLEMENTED** — deploy stale; redeploy needed (B2) |
| §13 Org & Governance Structure | authority classes, matrix, escalation, waivers | **IMPLEMENTED** |
| §14 Multi-Agent Architecture | Claude/Codex dual-adversarial, validator-first | **IMPLEMENTED** |
| §15 Temporal & Consistency | time semantics (`observed_at`/`captured_at`/…), PIT reconstruction | **IMPLEMENTED** |
| §16 Maturity Model (6 stages) | Stages 1–4 substantially landed; Stage 5 (exec/economic) code-merged; Stage 6 (institutional) partial/frozen | **PARTIALLY_IMPLEMENTED** |
| §17 Audit Framework | audit types, output format; this audit package is an instance | **IMPLEMENTED** |
| §18 Implementation Roadmap (Programs 1–5) | see `PROGRAM_ALIGNMENT_MATRIX.md` | **PARTIALLY_IMPLEMENTED** |
| §19 Workflow Runtime Addendum | proof-check, tier-sync, merge-gate, lane-lock, reconcile validators | **IMPLEMENTED** |
| §20 Board Execution Runtime | issue classes, activation states, stage activation | **IMPLEMENTED** (Linear board + lane manifests) |
| §21 Program 1 Sequence (UTV2-1083…1095) | all merged | **IMPLEMENTED** |
| §22 Anti-Patterns | most mechanically guarded; a few live (string-bound proof, edge-as-echo) | **PARTIALLY_IMPLEMENTED** |
| §23 End State | governance/truth GREEN; replay GREEN; edge/economic/capital not yet | **PARTIALLY_IMPLEMENTED** |

## Summary counts
- **IMPLEMENTED:** 4.2, 4.7, 4.8, 4.9, 4.10(code), 4.11, 4.13, 4.15, 4.16; principles 2.1–2.10, 2.12, 2.14; §5,6,8,9,13,14,15,17,19,20,21.
- **PARTIALLY_IMPLEMENTED:** 4.1, 4.3, 4.4, 4.5, 4.6, 4.12, 4.14, 4.18, 4.19; principles 2.11, 2.13; §7,10,11,12,16,18,22,23.
- **NOT_IMPLEMENTED:** 4.17 (frozen by design).
- **UNKNOWN:** none at code level; **runtime certification UNKNOWN/UNPROVEN** (`ops:cert-check` blocked on env).
