# Status Source of Truth

> **SUPERSEDED 2026-03-21.** This file is now a historical record. The active program status authority is `docs/06_status/PROGRAM_STATUS.md`. Do not update this file for new sprints.

This was the single authoritative file for current program state through Week 21.
Content below reflects state as of Week 21 close and is preserved as historical record.

## Snapshot Date

2026-03-21 (updated through Week 21 Promotion Scoring Enrichment)

## Current Program State

| Field | Value |
|---|---|
| Current Week | **Week 21 - CLOSED 2026-03-21** - Promotion scoring enrichment; domain analysis edge and Kelly fraction now inform trust and readiness fallbacks in promotion scoring; 531/531 tests; all gates pass |
| Week 20 | **CLOSED 2026-03-21** - E2E platform validation; all 9 runtime surfaces validated; live Discord canary proof delivered; 515/515 tests; all gates pass |
| Week 19 | **CLOSED 2026-03-21** - Promotion edge integration; domain analysis edge consumed as three-tier fallback in promotion scoring; 515/515 tests; all gates pass |
| Week 18 | **CLOSED 2026-03-21** - Domain integration layer; submission-time domain analysis enrichment using devig + kelly-sizer; 502/502 tests; all gates pass |
| Week 17 | **CLOSED 2026-03-21** - Git baseline ratification; first commit created from audited post-salvage repo state; 491/491 tests; all gates pass |
| Week 16 | **CLOSED 2026-03-21** - settlement downstream and loss attribution runtime integration complete; accepted Batch 1 through Batch 5 domain salvage foundation; 491/491 tests; independent verification PASS |
| Week 15 | **CLOSED 2026-03-21** - probability and devig math salvage; 128/128 tests |
| Week 14 | **CLOSED 2026-03-21** - verification control plane salvage; 100/100 tests |
| Week 13 | **CLOSED 2026-03-21** - operator trader-insights health; 87/87 tests |
| Week 12 | **CLOSED 2026-03-21** - settlement hardening complete; 83/83 tests |
| Week 11 | **CLOSED 2026-03-21** - trader-insights activation complete; real channel `1356613995175481405` live |
| Phase | Week 21 closed: promotion scoring enrichment; domain analysis now informs edge (Week 19), trust, and readiness (Week 21) in promotion scoring pipeline |
| Live Routing | `discord:canary` active; `discord:best-bets` live (`1288613037539852329`); `discord:trader-insights` live (`1356613995175481405`) |

## Proven Runtime Capabilities

- Supabase connected, generated types in use
- canonical submission intake live
- lifecycle transitions enforced
- promotion persistence and routing gates live
- Discord outbox, worker delivery, receipts, and audit logs live
- `discord:best-bets` live with runtime-governed routing
- `discord:trader-insights` live with runtime-governed routing
- canonical settlement API live
- manual review and additive correction chains live
- operator-web read-only monitoring live
- Week 14 complete: verification control plane salvage under `packages/verification`
- Week 15 complete: probability/devig/calibration salvage under `packages/domain/src/probability`
- Week 16 runtime integration complete:
  - `packages/domain/src/outcomes` is wired into `apps/api/src/settlement-service.ts`
  - canonical settlement API now returns downstream settlement truth
  - confirmed loss settlements compute loss attribution when runtime inputs exist
  - operator-web picks pipeline now resolves effective corrected settlement instead of raw settlement rows
  - recap/performance/accounting rebuilds remain out of scope and are not yet consumers
- Accepted Batch 1 domain salvage foundation present:
  - `packages/domain/src/market`
  - `packages/domain/src/features`
  - `packages/domain/src/models`
  - `packages/domain/src/signals`
- Accepted Batch 2 domain salvage foundation present:
  - `packages/domain/src/bands`
  - `packages/domain/src/calibration`
  - `packages/domain/src/scoring`
  - `packages/domain/src/calibration` intentionally imports directly from `@unit-talk/domain/calibration` and is not re-exported from the top-level domain index to avoid collision with `packages/domain/src/probability/calibration.ts`
- Accepted Batch 3 domain salvage foundation present:
  - `packages/domain/src/outcomes`
  - `packages/domain/src/evaluation`
  - `packages/domain/src/edge-validation`
  - additional `packages/domain/src/market/market-reaction.ts`
  - `packages/domain/src/evaluation` is intentionally not re-exported from the top-level domain index to avoid naming collisions with existing probability/calibration score helpers
  - timestamp injection preserved purity in `band-evaluation.ts` by avoiding `new Date()` inside domain computation
- Accepted Batch 4 domain salvage foundation present:
  - `packages/domain/src/rollups`
  - `packages/domain/src/system-health`
  - `packages/domain/src/outcomes/baseline-roi.ts`
  - `packages/domain/src/index.ts` now exports `rollups` and `system-health`
  - `packages/domain/src/outcomes/index.ts` now exports `baseline-roi`
- Accepted Batch 5 domain salvage foundation present:
  - `packages/domain/src/risk`
  - `packages/domain/src/strategy`
  - `packages/domain/src/index.ts` now exports `risk`
  - `packages/domain/src/strategy` remains intentionally commented out from the top-level domain index until the `americanToDecimal` naming collision is resolved cleanly
- all accepted salvage remains pure computation
- Week 18 domain integration layer complete:
  - `apps/api/src/domain-analysis-service.ts` computes implied probability, edge, and Kelly sizing at submission time
  - Uses `americanToImplied` from `@unit-talk/domain` (probability/devig) and `americanToDecimal`/`computeKellyFraction` from `@unit-talk/domain` (risk/kelly-sizer)
  - `apps/api/src/submission-service.ts` enriches `pick.metadata.domainAnalysis` before persistence
  - Fail-open: picks without odds are not enriched
  - 11 new tests; all repo gates pass at 502/502 tests
- Week 19 promotion edge integration complete:
  - `apps/api/src/promotion-service.ts` now reads `metadata.domainAnalysis.edge` as a second-tier fallback for promotion edge scoring
  - Three-tier edge fallback: explicit `promotionScores.edge` > domain analysis edge > confidence-based fallback
  - `readDomainAnalysisEdgeScore()` converts raw mathematical edge (-0.5 to +0.5) to 0-100 promotion scale via `clamp(50 + rawEdge * 400, 0, 100)`
  - No changes to promotion policy definitions, thresholds, or evaluation logic
  - 13 new tests; all repo gates pass at 515/515 tests
- Week 20 E2E platform validation complete:
  - All 9 runtime surfaces validated end-to-end
  - Live Discord canary proof delivered (message ID `1485075639424782337`)
  - Validation-only sprint, no new code changes
  - 515/515 tests
- Week 21 promotion scoring enrichment complete:
  - `readDomainAnalysisTrustSignal()` derives trust from domain analysis positive edge (80 for edge ≥ 0.05, 65 for marginal)
  - `readDomainAnalysisReadinessSignal()` derives readiness from Kelly fraction (85 when Kelly > 0)
  - `readPromotionScoreInputs()` now uses domain-aware fallbacks: trust and readiness join edge as domain-analysis-informed inputs
  - Trust fallback chain: explicit promotionScores.trust > domain trust signal > confidence
  - Readiness fallback chain: explicit promotionScores.readiness > domain readiness signal > 80
  - No changes to promotion policy definitions, thresholds, or evaluation logic
  - 16 new tests; all repo gates pass at 531/531 tests

## Week Status

| Week | Status | Truth |
|---|---|---|
| Week 21 | **CLOSED** | Promotion scoring enrichment; domain-aware trust and readiness signals; 531/531 tests 2026-03-21 |
| Week 20 | **CLOSED** | E2E platform validation; all 9 runtime surfaces validated; 515/515 tests 2026-03-21 |
| Week 19 | **CLOSED** | Promotion edge integration; domain analysis edge consumed in promotion scoring; 515/515 tests 2026-03-21 |
| Week 18 | **CLOSED** | Domain integration layer; submission-time domain analysis enrichment; 502/502 tests 2026-03-21 |
| Week 17 | **CLOSED** | Git baseline ratification; first commit created from audited repo state 2026-03-21 |
| Week 16 | **CLOSED** | Runtime integration complete; Batch 1 through Batch 5 domain salvage foundation accepted; independent verification PASS 2026-03-21 |
| Week 15 | **CLOSED** | Probability/devig math salvage complete and independently verified |
| Week 14 | **CLOSED** | Verification control plane salvage complete and independently verified |
| Week 13 | **CLOSED** | Operator trader-insights health complete and independently verified |
| Week 12 | **CLOSED** | Settlement hardening complete and independently verified |
| Week 11 | **CLOSED** | Trader-insights framework + activation complete and independently verified |

## Live Routing State

| Target | Status | Condition |
|---|---|---|
| `discord:canary` | **LIVE** | Permanent control lane. Never removed. |
| `discord:best-bets` | **LIVE (CONTROLLED)** | Real-channel activation completed. Continue monitoring and retain canary. |
| `discord:trader-insights` | **LIVE** | Real channel `1356613995175481405`. |
| `discord:exclusive-insights` | **BLOCKED** | Not implemented. |
| `discord:game-threads` | **BLOCKED** | Thread routing not implemented. |
| `discord:strategy-room` | **BLOCKED** | DM routing not implemented. |

## Open Risks

| Risk | Status |
|---|---|
| Historical pre-fix outbox rows may add noise to operator incident triage | Open - low severity |
| Week 16 independent verification | **Resolved** — PASS recorded 2026-03-21 |
| Recap/performance/accounting surfaces do not yet consume Week 16 downstream truth | Open - explicitly out of current scope |
| Batch 5 acceptance and Week 16 closeout evidence must stay in sync across repo, Notion, and Linear | Open - Notion and Linear sync pending |

## Authority Links

| Purpose | File |
|---|---|
| Current phase summary | `docs/06_status/current_phase.md` |
| Next build order | `docs/06_status/next_build_order.md` |
| Week 11 contract | `docs/05_operations/week_11_trader_insights_activation.md` |
| Week 12 contract | `docs/05_operations/week_12_settlement_hardening_contract.md` |
| Week 13 contract | `docs/05_operations/week_13_operator_trader_insights_health_contract.md` |
| Week 14 contract | `docs/05_operations/week_14_verification_control_plane_salvage_contract.md` |
| Week 15 contract | `docs/05_operations/week_15_probability_devig_salvage_contract.md` |
| Week 16 contract | `docs/05_operations/week_16_settlement_downstream_loss_attribution_contract.md` |
| Week 17 contract | `docs/05_operations/week_17_git_baseline_ratification_contract.md` |
| Week 18 contract | `docs/05_operations/week_18_domain_integration_layer_contract.md` |
| Week 19 contract | `docs/05_operations/week_19_promotion_edge_integration_contract.md` |
| Week 20 contract | `docs/05_operations/week_20_e2e_platform_validation_contract.md` |
| Week 21 contract | `docs/05_operations/week_21_promotion_scoring_enrichment_contract.md` |
| Migration ledger | `docs/05_operations/migration_ledger.md` |
| Week 16 proof template | `docs/06_status/week_16_proof_template.md` |
| Week 16 failure note template | `docs/06_status/week_16_failure_note_template.md` |
| Week 16 closeout checklist | `docs/06_status/week_16_closeout_checklist.md` |
| Settlement planning | `docs/05_operations/settlement_planning.md` |
| Settlement architecture | `docs/02_architecture/contracts/settlement_contract.md` |
| Detailed runtime evidence | `docs/06_status/system_snapshot.md` |

## Update Rule

Update this file:
- at every week boundary
- when any live routing state changes
- when a program kill condition is triggered

Do not let this file fall more than one milestone behind.
