# Constitution Implementation Matrix

> Original: SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001 · 2026-06-02 · HEAD `a0614837`.
> **Re-statused 2026-10-11 (WORK-2026101103)** against `origin/main` `9ff70858cd0095a3ced7b4232c2cdb97ad5bf45f`. The original claim of every row is preserved in the "Prior claim" column or text; only the status vocabulary and the evidence changed.
> Maps every constitutional section to repo implementation, enforcement, tests, CI gates, and status. **Gaps are reported, never hidden.** Status reflects *code + proof on `main`*, not aspiration.

## Verification note

**Verified on 2026-10-11 against `main` `9ff70858cd0095a3ced7b4232c2cdb97ad5bf45f`.** Method: for each cited control, a word-match `git grep` over `apps/`, `packages/`, `scripts/` on `origin/main`, excluding tests, `dist`, `.d.ts` and `.md`, looking for a caller outside the defining module and its tests; for DB-level controls, `CREATE TRIGGER` / constraint lines in `supabase/migrations/00000000000000_baseline_live_schema.sql` plus a scan of every later migration for `DROP TRIGGER`, `DISABLE TRIGGER` and redefinition of the guard functions; for CI controls, live branch protection and the workflow files (see `REQUIRED_CI_CHECKS.md` §0). Reproduction commands are in the section "Reproducing this verification" below.

**Limits of this verification (what was not measured).**
- Evidence is repository-level. Live `pg_trigger` and live constraint catalogs were **not** queried; "present in the migration set" is not "present in production".
- `20260928131714_utv2_1370_warehouse_retention.sql` redefines `raw_payloads_immutable()` and `odds_snapshots_immutable()` so DELETE (never UPDATE) is allowed inside the retention executor under a valid unexpired plan. Whether that migration is applied in production is not verified (`docs/mission/plan.md` §5 decision 10 lists it as pending Griff).
- Runtime counts quoted in the original matrix (79,625 `audit_log` rows, 191 dead-letters, 229 constitutional tests, 282/288 test counts) were **not** re-measured and are kept only as historical text.
- "Production-wired" means a non-test caller exists in the app that runs. It does not mean the app is running: containment (`parked` / `human-capper`) governs which schedulers and delivery targets are live (`docs/mission/plan.md` §7).
- The ratified program certification rulings (`CANONICAL_PROGRAM_STATE.md`: P1 and P2 ACTIVE_CERTIFIED; P3 ACTIVE_NOT_CERTIFIED; P4 CONDITIONAL_NOT_CERTIFIED; P5 FROZEN) are PM decisions. **This re-statusing does not amend them.** Rows that a ruling rests on and that measure as `PRIMITIVE_ONLY` here (notably 4.13) are surfaced for PM review, not corrected by this document.

## Status vocabulary

The original single word `IMPLEMENTED` conflated a tested primitive with an active control. Each row now carries one or more of the following. A row with several parts lists each part's status separately; no status is averaged.

| Status | Meaning | Evidence required |
|---|---|---|
| `ENFORCED_IN_PRODUCTION` | The control runs on the production path: a non-test production caller in an app, or a DB trigger / constraint present in the repo's migration set. Whether the owning scheduler or target is currently live is stated separately (containment). | file:line of the caller, or the migration line |
| `ENFORCED_IN_CI` | The control is a **required** branch-protection check on `main` (`verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`). It binds non-admin merges only: `enforce_admins` is `false`. | the required context and workflow |
| `ADVISORY_IN_CI` | A workflow or script runs but is not a required context, is path-filtered, scheduled, or `workflow_dispatch`-only. It can report red without blocking a merge. | workflow file |
| `PRIMITIVE_ONLY` | Code and tests exist, but no non-test production caller. It cannot fire in production. Nothing has been wired by this document. | the definition site and the absence of a caller |
| `PROCEDURAL` | Upheld by operator or agent procedure, not by code that runs. | the procedure document |
| `DOC_ONLY` | A statement in documentation with no code, test, or check behind it. | none |
| `NOT_IMPLEMENTED` | Absent, intentionally or not. | none |
| `UNVERIFIED` | Not re-measured by this verification; the prior claim is retained as history only. | none |

## §2 Constitutional Principles

| Principle | Prior claim (2026-06-02) | Re-verified status (2026-10-11) | Evidence |
|---|---|---|---|
| 2.1 Truth Before Prediction | **IMPLEMENTED** (code); edge is market-echo | `ENFORCED_IN_PRODUCTION` (DB immutability of raw capture); edge-as-echo stands | `raw_payloads` no-update/no-delete triggers baseline `:5563`/`:5570`; `odds_snapshots` immutable `:5661`. Retention executor may DELETE under a valid plan (`20260928131714_utv2_1370_warehouse_retention.sql:691,:715`); UPDATE is still refused |
| 2.2 Determinism Before Automation | **IMPLEMENTED** | `PRIMITIVE_ONLY` (`IsolatedReplayStore`, `replayPromotion`, `replayRecordedPromotion`) | `IsolatedReplayStore` (`packages/verification/src/engine/full-pipeline-replay.ts:75`) is referenced only by `scripts/utv2-320-nba-simulation.ts` and tests; `packages/verification` is imported by `apps/api/src/scripts/query-runs.ts` only. `replayPromotion` (`packages/domain/src/promotion.ts:700`) and `replayRecordedPromotion` (`:902`) are called only from inside that module (`:929`) and tests; `apps/api/src/promotion-service.ts:568` mentions replay in a comment only. Persisted promotion snapshots exist, but nothing in an app replays them |
| 2.3 Fail Closed | **IMPLEMENTED** | `ENFORCED_IN_PRODUCTION` per control, not as a global property | `isKilled` fails closed (`apps/worker/src/runner.ts:268-303`, call at `:303`); the `TRACK_ONLY_INTENT_GUARD` block (`apps/api/src/handlers/submit-pick.ts:128-163`); `env:check` runs in `verify:static` (`ENFORCED_IN_CI`). Other `assert*` guards named in the prior claim are individually re-statused below |
| 2.4 Immutable History | **IMPLEMENTED** | `ENFORCED_IN_PRODUCTION` (DB triggers, repo-level) | `audit_log` `guard_audit_log_immutability` baseline `:5500` (fn `reject_audit_log_mutation` `:1538`); `settlement_records` immutable `:5682`; `cert_events` `:5451`/`:5458`; `certification_records` `:5465`/`:5472`; `execution_intents` `:5486`/`:5493`. No later migration drops or disables these. Live catalog not queried |
| 2.5 Explicit Authority | **IMPLEMENTED** | `PRIMITIVE_ONLY` (`AUTHORITY_MATRIX`, `assertAuthority`, `enforceAuthority`, `assertFieldAuthority`). Production authorization is a different mechanism: the route-role table, `ENFORCED_IN_PRODUCTION` | `apps/api/src/authority-enforcement.ts:29,:44` has zero importers; `packages/contracts/src/operator-role.ts:66,:165` is reachable only through it; `packages/db/src/writer-authority.ts:65` is re-exported at `packages/db/src/index.ts:55` and never called. Route roles: `apps/api/src/auth.ts` (~`:54-71`) |
| 2.6 Replayability | **IMPLEMENTED** (substrate) | `PRIMITIVE_ONLY` (replay substrate, see 2.2); `ADVISORY_IN_CI` (`shadow-parity-required.yml`) | `shadow-parity-required.yml` is path-triggered and not a required context |
| 2.7 Auditability | **IMPLEMENTED** (data); PARTIAL UI | `ENFORCED_IN_PRODUCTION` (append-only `audit_log` trigger); `ADVISORY_IN_CI` (proof gate); row count `UNVERIFIED` | trigger as 2.4. `proof-auditor-gate.yml` is `workflow_dispatch`-only and superseded by `proof-gate.yml`, which is not required (`REQUIRED_CI_CHECKS.md` §5.6, §5.8). "79,625 rows" not re-measured |
| 2.8 Separation of Duties | **IMPLEMENTED** | `PRIMITIVE_ONLY` (dual-auth, approval-expiration); DB check on `settlement_corrections` present but has **no writer**; `PROCEDURAL` (executor/reviewer split) | `packages/contracts/src/dual-auth.ts` (`createPendingApproval` `:65`, `completeApproval` `:96`) and `packages/contracts/src/approval-expiration.ts:52` call only each other and tests. `settlement_corrections_distinct_authorizers` check baseline `:3455`, trigger `trg_settlement_corrections_validate` `:5675`; no application writes the table. Production correction path is `apps/api/src/settlement-service.ts:931` `recordSettlementCorrection`, which takes a single `settledBy` |
| 2.9 Human Governance | **IMPLEMENTED** | `ENFORCED_IN_CI` (`Merge Gate`), subject to `enforce_admins: false`; `ADVISORY_IN_CI` (`tier-label-check.yml`) | `Merge Gate` is a required context: T1 needs `t1-approved` and a head-bound `pm-verdict/v1` APPROVED; T2 any one of three paths; T3 auto-pass (`REQUIRED_CI_CHECKS.md` §4.3). `tier-label-check.yml` is not required |
| 2.10 Labels Are Evidence Not Truth | **IMPLEMENTED** | `PROCEDURAL` (truth hierarchy in `CLAUDE.md`); `ADVISORY_IN_CI` (`doc-truth-gate.yml`, path-filtered to two documents) | `doc-truth-gate.yml` triggers only on `docs/02_architecture/week_19_downstream_consumer_matrix.md` and `docs/03_contracts/domain_analysis_consumer_contract.md` |
| 2.11 Proof Over Narrative | **PARTIALLY_IMPLEMENTED** | `ENFORCED_IN_CI` (`Executor Result Validation`; `verify` verifies the staging DB proof receipt); `ADVISORY_IN_CI` (`proof-gate.yml`, `evidence-bundle-validate.yml`, `proof-coverage-guard.yml`) | `verify` runs `scripts/ci/verify-db-proof-receipt.ts --command "pnpm test:db"`. The prior claim's gap C-1 (gate greps the string `test:db`) concerned the retired `t1-proof-gate`; the replacement path is not re-audited here |
| 2.12 Revocable Trust | **IMPLEMENTED** | `ENFORCED_IN_PRODUCTION` (narrow: stale-proof invalidation at worker start); `PRIMITIVE_ONLY` (the broader dependent-gate BFS and state machine); `PROCEDURAL` (operator CLI) | `invalidateExpiredCertificationProofs` (`apps/worker/src/certification-runtime.ts:223-259`) is called at `apps/worker/src/index.ts:74`, scoped to program P1 and domains `proof_lineage` and `freshness`. `DependentGateChecker` and the state machine are used by `scripts/ops/cert-check.ts` only. `RevocationTriggerWiring.wireEngine` (`packages/invariants/src/certification/revocation-trigger-wiring.ts:74`) has no caller |
| 2.13 Adversarial Validation | **PARTIALLY_IMPLEMENTED** | `PRIMITIVE_ONLY` | `packages/domain/src/adversarial/*` (burn-in, escalation, manipulation-detector, provider-anomaly, replay, independent-data-path): no `apps/` caller |
| 2.14 No Self-Certification | **IMPLEMENTED** | `PROCEDURAL`; `ADVISORY_IN_CI` (`codex-return-review.yml`, `r-level-compliance-check.yml`). Note: `Merge Gate` T2 accepts an `executor-result/v1` self-attestation comment from a CODEOWNERS member (UTV2-1523) | `merge-gate.yml` T2 policy; neither named workflow is a required context |

## §4 Capability Layers (the 19)

Columns: **Prior** is the 2026-06-02 CODE status; **Runtime** is the 2026-06-02 runtime reading, retained as history only and **not** re-measured (current runtime facts live in `docs/mission/plan.md` §1-§2).

| Layer | Prior (CODE / RUNTIME) | Re-verified status (2026-10-11) | Evidence (file:line, production caller or DB object) |
|---|---|---|---|
| **4.1 Data Acquisition** | PARTIALLY_IMPLEMENTED / RED ingestion dark | `ENFORCED_IN_PRODUCTION` (code); runtime `PARKED` by containment (SGO parked); `ADVISORY_IN_CI` (`ingestor-staleness-alert.yml`, scheduled) | `apps/ingestor` runs only when ingestor autorun is on; the `human-capper` mode sets it off (`docs/mission/plan.md` §7). `raw_payloads` triggers as 2.1 |
| **4.2 Canonical Data Truth** | IMPLEMENTED / live-verified | `ENFORCED_IN_PRODUCTION` (DB triggers); `ADVISORY_IN_CI` (`live-schema-parity.yml`) | baseline `:5563`, `:5570`, `:5661`; see the retention-migration caveat in the verification note |
| **4.3 Feature Engineering** | PARTIALLY_IMPLEMENTED | Mixed: `ENFORCED_IN_PRODUCTION` for matchup context; `PRIMITIVE_ONLY` for the remaining feature modules and `computeStatProjection` | `computeMatchupContext`, `applyMatchupContextToProbability`, `evaluateAvailabilityConfidence` called from `apps/api/src/candidate-scoring-service.ts:473-474,:631` (scheduler registered `apps/api/src/index.ts:179-181`, gated by SYNDICATE/containment mode). `computeStatProjection` (`packages/domain/src/models/stat-distribution.ts:128`) and `computeStatMarketBlend` (`stat-market-blend.ts:79`): zero non-test callers. `player-form`, `opportunity`, `efficiency`, `game-context` (`extractGameContextFeatures` appears only in a comment, `runtime-repositories.ts:11028`): unused in production |
| **4.4 Modeling & Prediction** | PARTIALLY_IMPLEMENTED | `ENFORCED_IN_PRODUCTION` (artifact SHA immutability); champion remains market-echo | `model_registry` artifact_sha immutable trigger baseline `:5654` |
| **4.5 Calibration & Model Governance** | PARTIALLY_IMPLEMENTED | `PRIMITIVE_ONLY` (`probability/calibration.ts`, `calibration-gate`, `calibration-proof`, `cohort-hold`, `deployment-hold`); `ENFORCED_IN_PRODUCTION` (model-health scan) | calibration functions are referenced only by domain `system-health-report`, whose runner `generateSystemHealthReport` has no app caller. Model-health scan: scheduler registration `apps/api/src/index.ts:270-283` runs `runModelHealthScan`, which calls `evaluateModelHealthState` at `apps/api/src/model-health-scanner.ts:238` |
| **4.6 Edge Detection** | PARTIALLY_IMPLEMENTED | `ENFORCED_IN_PRODUCTION` (minimum-edge gate inside promotion eligibility); `PRIMITIVE_ONLY` (`detectEdgeDecay`) | `packages/domain/src/promotion.ts:344-349` reached via `evaluatePromotionEligibility` at `apps/api/src/promotion-service.ts:489,:802`. Edge remains structurally a market echo |
| **4.7 Risk Management** | IMPLEMENTED | `ENFORCED_IN_PRODUCTION` (Kelly sizing, risk score); `PRIMITIVE_ONLY` (`routeNegativeEvDecision`) | `computeKellySize`: `promotion-service.ts:276`, `submission-service.ts:1228`. `computeRiskScore`: `promotion-service.ts:509,:828`. `routeNegativeEvDecision` (kelly-sizer): no caller |
| **4.8 Portfolio & Exposure** | IMPLEMENTED | Mixed: `ENFORCED_IN_PRODUCTION` for board-fit and the app-local exposure gate; `PRIMITIVE_ONLY` for the domain portfolio hard-block modules | `computeBoardFitScore` `promotion-service.ts:1083`; app-local `checkExposureGate` called `:434` (defined `:1609`), **skipped when source is `smart-form`** (`:433`). `concentration-hard-blocks`, `drawdown-monitor`, `exposure-store`, `exposure-consistency`, `sizing-signal`, `concentration`, `correlation`: referenced only inside the board-fit chain or tests; no app caller of the hard-block or daily-loss-limit paths |
| **4.9 Decision Engine** | IMPLEMENTED | `ENFORCED_IN_PRODUCTION` (promotion gates; decision persisted by the promotion service); `PRIMITIVE_ONLY` (the immutable `DecisionRecord` as an audit store) | `evaluatePromotionEligibility` `promotion-service.ts:489,:802`; `persistPromotionDecision` (promotion-service). `createDecisionRecord` is reached only via `kelly-sizer.ts:204`; `createForcePromotionExceptionDecisionRecord` via `promotion.ts:382`; no `decision_records` table, repository or persistence exists |
| **4.10 Execution & Distribution** | IMPLEMENTED (code) / RED 191 dead-letters | `ENFORCED_IN_PRODUCTION` (outbox, `DeliveryOutcome`, circuit breaker, kill switch, dead-letter reset); `PRIMITIVE_ONLY` (`ExecutionIntent` domain and confirmation service) | `DeliveryOutcome` type `apps/worker/src/distribution-worker.ts:37`; `DeliveryCircuitBreaker` `apps/worker/src/runner.ts:23,:122`; kill switch `runner.ts:303` (`isKilled`, fail-closed); dead-letter reset `apps/api/src/controllers/retry-delivery-controller.ts:35,:61-64`. `apps/api/src/execution-confirmation-service.ts` has no importer; the `execution_intents` repository exists (`runtime-repositories.ts:10931+`) and the table has immutability triggers (baseline `:5486`/`:5493`), but nothing appends. "191 dead-letters" not re-measured |
| **4.11 Settlement & Outcome** | IMPLEMENTED / live-verified | `ENFORCED_IN_PRODUCTION` (settlement immutability, additive `corrects_id` path); `PRIMITIVE_ONLY` (dual-authorizer correction) | `settlement_records` immutable trigger baseline `:5682`, `stake_units` trigger `:5689`; correction path `settlement-service.ts:931` is single-authorizer. The DB-level two-authorizer check on `settlement_corrections` is dormant (no writer; see 2.8) |
| **4.12 Performance Evaluation** | PARTIALLY_IMPLEMENTED | Mixed: `ENFORCED_IN_PRODUCTION` for CLV computation at settlement; `PRIMITIVE_ONLY` for performance cohorts and the stand-alone ROI/attribution modules | `computeCLVOutcome` defined `clv-service.ts:217`, called `settlement-service.ts:169,:380` (the correction path computes CLV fail-open, `settlement-service.ts:954`). `performance-cohort`, `attributePick`, `decomposePerformance`, `reconstructAttribution`: no `apps/` caller (only `resolveStakeUnits` from `attribution` is used, by grading, `submit-pick` and settlement) |
| **4.13 Runtime Integrity** | IMPLEMENTED / partial | `PRIMITIVE_ONLY` (`InvariantEngine`, `QuarantineManager`); `ADVISORY_IN_CI` (`invariant-registry-gate.yml`, path-filtered) | no app instantiates `InvariantEngine`. `apps/worker/src/certification-runtime.ts` uses `CertificationLifecycleManager` and `RevocationTriggerWiring.triggerStaleProofLineage` only (see 2.12). **Surfaced for PM:** `CANONICAL_PROGRAM_STATE.md` lists 4.13 under P1 `ACTIVE_CERTIFIED`; this measurement does not amend that ruling |
| **4.14 Observability** | PARTIALLY_IMPLEMENTED / partial | `ADVISORY_IN_CI` (scheduled monitors `pipeline-health-monitor.yml`, `ops-burn-in-monitor.yml`, `ingestor-staleness-alert.yml`); health route exists but fails open in a known case (`docs/mission/plan.md` §4.2) | scheduled workflows alert but never block a merge. "Loki not deployed", "firing into a void" not re-verified: `UNVERIFIED` |
| **4.15 Governance & Certification** | IMPLEMENTED / UNPROVEN | `ENFORCED_IN_PRODUCTION` (certification table immutability; worker startup invalidation, narrow scope); `PROCEDURAL` (operator `ops:cert-check`); `PRIMITIVE_ONLY` (governance-exception, proof-freshness, merge-sha-binding and proof-validator gates) | triggers baseline `:5451`-`:5472`; worker wiring as 2.12. The gate modules have no production caller; `scripts/proof-check.ts` defines its own `validateProofBundle`, not the `invariants` one |
| **4.16 Human Operations** | IMPLEMENTED / PARTIAL | `ENFORCED_IN_CI` (`Merge Gate`, `Executor Result Validation`); `PROCEDURAL` (escalation, runbooks); `PRIMITIVE_ONLY` (`AUTHORITY_MATRIX`, `buildAdversarialEscalation`) | as 2.5, 2.9, 2.13. Incident runbooks are DRAFT and non-binding (`docs/mission/spec.md`) |
| **4.17 Capital Operations & Treasury** | NOT_IMPLEMENTED (frozen) | `NOT_IMPLEMENTED` (unchanged). Freeze is declarative: `assertDomainNotFrozen` is `PRIMITIVE_ONLY` | `packages/contracts/src/governance-rollback.ts:30` (`assertDomainNotFrozen`), `:177` (`authorizeRollback`) call only each other and tests |
| **4.18 Market Adversarial Intelligence** | PARTIALLY_IMPLEMENTED | `PRIMITIVE_ONLY` | as 2.13 |
| **4.19 Economic Attribution** | PARTIALLY_IMPLEMENTED | `PRIMITIVE_ONLY` | as 4.12: `AttributionEngine`, `PerformanceCohort`, `detectEdgeDecay` have no `apps/` caller |

## §5-§20 System / governance sections

| Section | Prior claim | Re-verified status (2026-10-11) | Basis |
|---|---|---|---|
| §5 Component Architecture | **IMPLEMENTED** (boundaries enforced) | `ENFORCED_IN_CI` for the DB-client boundary (`ci:db-client-boundary` inside `verify:static`); the remaining apps/packages import rules `UNVERIFIED` as a mechanical check | `ci.yml` job `verify`; no per-rule mechanical audit performed here |
| §6 Technical Stack | **IMPLEMENTED** | `ENFORCED_IN_PRODUCTION` (Postgres triggers as 2.4); RLS deny-all and live-schema parity `UNVERIFIED` here | `live-schema-parity.yml` is `ADVISORY_IN_CI` |
| §7 Canonical Domain Model (21 entities) | **PARTIALLY_IMPLEMENTED** | Mixed: tables `ENFORCED_IN_PRODUCTION`; `DecisionRecord` `PRIMITIVE_ONLY` (no persistence); capital entities `NOT_IMPLEMENTED` | see 4.9, 4.17; `database.types.ts` drift (D-CONST-7) resolved per gap register |
| §8 Contracts & Interfaces | **IMPLEMENTED** | Mixed: contracts `ENFORCED_IN_PRODUCTION` where imported; `writer-authority` `PRIMITIVE_ONLY` | D-CONST-8 corrected the *wording* of the fail-closed docs; the function is fail-closed **when called**, and it is not called (see 2.5) |
| §9 Operating Model (T1/T2/T3) | **IMPLEMENTED** | `ENFORCED_IN_CI` (`Merge Gate`), `enforce_admins: false` | `REQUIRED_CI_CHECKS.md` §4.3 |
| §10 Proof & Certification Framework | **PARTIALLY_IMPLEMENTED** | Mixed: `ENFORCED_IN_CI` (`Executor Result Validation`, `verify` receipt check); `ADVISORY_IN_CI` (`proof-gate.yml`); `PRIMITIVE_ONLY` (16 cert classes beyond the worker's narrow scope) | as 2.11, 2.12 |
| §11 Security & Trust | **PARTIALLY_IMPLEMENTED** | `UNVERIFIED` (advisor findings, RPC grants and RLS not re-queried); dual-auth is `PRIMITIVE_ONLY` (2.8) | no live advisor query in this lane |
| §12 Infrastructure & Topology | **PARTIALLY_IMPLEMENTED** | `UNVERIFIED`; deploys are `PROCEDURAL` (`deploy.yml` is `workflow_dispatch`-only and dispatching is reserved to Griff) | the 2026-06 "deploy stale" reading is superseded by `docs/mission/plan.md` §1 |
| §13 Org & Governance Structure | **IMPLEMENTED** | `PROCEDURAL`; CODEOWNERS is `* @griff843` | `.github/CODEOWNERS` |
| §14 Multi-Agent Architecture | **IMPLEMENTED** | `PROCEDURAL` | as 2.14 |
| §15 Temporal & Consistency | **IMPLEMENTED** | `UNVERIFIED` | not re-measured |
| §16 Maturity Model | **PARTIALLY_IMPLEMENTED** | `DOC_ONLY` | descriptive |
| §17 Audit Framework | **IMPLEMENTED** | `DOC_ONLY` / `PROCEDURAL` | this package is an instance of an audit |
| §18 Implementation Roadmap | **PARTIALLY_IMPLEMENTED** | `DOC_ONLY` | `PROGRAM_ALIGNMENT_MATRIX.md`, `CANONICAL_PROGRAM_STATE.md` govern |
| §19 Workflow Runtime Addendum | **IMPLEMENTED** | Mixed: `ENFORCED_IN_CI` (`Merge Gate`, `P0 Protocol`, `Executor Result Validation`); `ADVISORY_IN_CI` (`wfr-validators` job inside `merge-gate.yml`, a separate job that is not a required context; `merge-gate.yml:644` calls proof-check "advisory in CI") | `merge-gate.yml:586,:644` |
| §20 Board Execution Runtime | **IMPLEMENTED** | `PROCEDURAL` (lane manifests, lane CLI); several lane checks are `ADVISORY_IN_CI` | `docs/06_status/lanes/` |
| §21 Program 1 Sequence (UTV2-1083…1095) | **IMPLEMENTED** (all merged) | `DOC_ONLY` as a status: "merged" is recorded history, not a wiring claim; component status is in the rows above | history |
| §22 Anti-Patterns | **PARTIALLY_IMPLEMENTED** | `DOC_ONLY` | descriptive |
| §23 End State | **PARTIALLY_IMPLEMENTED** | `DOC_ONLY` | descriptive |

## Summary (re-verified rows)

Each row's **primary** classification, taken from the tables above. "Mixed" rows contain more than one status; their parts are listed in the row and are not averaged.

- **Single status.** `ENFORCED_IN_PRODUCTION`: 2.1, 2.4, 4.4, 4.2 (DB triggers; live catalog not queried). `ENFORCED_IN_CI`: 2.9, §9. `PRIMITIVE_ONLY`: 2.2, 2.5, 2.13, 4.13, 4.18, 4.19. `PROCEDURAL`: 2.14, §13, §14, §20. `DOC_ONLY`: §16, §17, §18, §21, §22, §23. `NOT_IMPLEMENTED`: 4.17. `UNVERIFIED`: §11, §12, §15.
- **Mixed (production part and primitive/advisory part).** 2.3, 2.6, 2.7, 2.8, 2.10, 2.11, 2.12; 4.1, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.14, 4.15, 4.16; §5, §6, §7, §8, §10, §19.

The prior summary listed 4.2, 4.7, 4.8, 4.9, 4.10 (code), 4.11, 4.13, 4.15, 4.16 and most principles as `IMPLEMENTED`. After re-statusing, **no layer is wholly an active production control**: 4.7-4.12, 4.15 and 4.16 each combine a wired part with a `PRIMITIVE_ONLY` part, and 4.13 is `PRIMITIVE_ONLY` outright.

## Reproducing this verification

Run from a clone with `origin/main` fetched. `R` is the revision verified.

```bash
R=origin/main
git rev-parse $R
# 1. Does a production caller exist? Replace SYMBOL. Any hit outside the defining file is a caller to inspect.
git grep -n -w 'SYMBOL' $R -- apps packages scripts \
  ':!*.test.ts' ':!**/dist/**' ':!*.d.ts' ':!*.md'
# Symbols used in this matrix:
#   enforceAuthority enforceAllAuthorities assertAuthority assertFieldAuthority
#   createPendingApproval completeApproval assertApprovalNotExpired authorizeRollback assertDomainNotFrozen
#   computeStatProjection computeStatMarketBlend detectEdgeDecay attributePick decomposePerformance
#   createDecisionRecord routeNegativeEvDecision IsolatedReplayStore InvariantEngine QuarantineManager wireEngine
#   computeKellySize computeRiskScore evaluatePromotionEligibility computeBoardFitScore checkExposureGate
#   computeCLVOutcome invalidateExpiredCertificationProofs DeliveryCircuitBreaker isKilled
#   replayPromotion replayRecordedPromotion evaluateModelHealthState
#   (TRACK_ONLY_INTENT_GUARD is a marker comment block, not a symbol: grep -n TRACK_ONLY_INTENT_GUARD apps/api/src/handlers/submit-pick.ts)
# 2. DB triggers in the baseline, and any later change to them
git grep -n 'CREATE TRIGGER' $R -- supabase/migrations/00000000000000_baseline_live_schema.sql
git grep -n -i -E 'DROP TRIGGER|DISABLE TRIGGER' $R -- supabase/migrations
git grep -n -E 'raw_payloads_immutable|odds_snapshots_immutable' $R -- supabase/migrations
# 3. Settlement-corrections writers (expect none in application code)
git grep -n -w 'settlement_corrections' $R -- apps packages/db/src ':!*.test.ts' ':!**/dist/**' ':!packages/db/src/database.types.ts'
# 4. CI facts: see REQUIRED_CI_CHECKS.md section 0 for branch-protection and workflow commands
gh api repos/griff843/Unit-Talk-v2/branches/main/protection | jq '.required_status_checks.contexts, .enforce_admins.enabled'
```

A caller found only in a `*.test.ts` file, a `dist/` build output, a declaration file, or a Markdown file does not count as production use. A caller inside `scripts/ops/` is an operator CLI and is classified `PROCEDURAL`.

## Follow-ups (code or policy; not done in this lane)

This lane is documentation-only. The following were found and **not** changed:

1. `scripts/ops/architecture-proof.ts:115` emits "Writer authority: packages/db/src/writer-authority.ts — 5 registered fields with explicit write auth" as evidence under a hard-coded `verdict: 'PROVEN'`; `scripts/ops/remaining-infra-proofs.ts:79-80` does the same (D5, "writer authority (5 fields)"). The control it cites never runs (2.5). Code change needed.
2. `packages/db/CLAUDE.md:26,:37` and `packages/contracts/CLAUDE.md:42` describe writer-authority fail-closed enforcement; true of the function, but it has no caller.
3. `docs/06_status/CURRENT_STATE.md:37` repeats "D-CONST-5 RESOLVED"; see the annotation in `CERTIFICATION_GAP_REGISTER.md`.
4. Whether to wire `enforceAuthority`, `assertFieldAuthority`, dual authorization on `settlement_corrections`, the `InvariantEngine`, or `computeStatProjection` is a product and PM decision. This document recommends none.
5. `CANONICAL_PROGRAM_STATE.md` program rulings that rest on 4.13 (P1) and the 4.3-4.5, 4.8, 4.9 rows (P3) are PM-owned and are not amended here.
