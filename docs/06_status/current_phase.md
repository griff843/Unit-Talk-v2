# Current Phase

## Status

**Week 18 closed 2026-03-21.** Domain integration layer. First salvaged domain modules wired into real API submission path. `domain-analysis-service.ts` computes implied probability (via `americanToImplied`), edge (vs submitter confidence), and Kelly fraction (via `computeKellyFraction`) at submission time. Results stored in `pick.metadata.domainAnalysis`. Fail-open: picks without odds are not enriched. 11 new tests. All gates pass at 502/502 tests.

**Week 17 closed 2026-03-21.** Git baseline ratification. First commit created from audited post-salvage repo state. `.gitignore` hardened to exclude proof artifacts (`out/`, `.week9-proof.json`). Status docs reconciled. All gates pass at 491/491 tests. Repo is now version-controlled and ready for app-layer buildout.

**Week 16 closed 2026-03-21.** Settlement downstream & loss attribution runtime integration complete. Independent verification PASS. `recordPickSettlement()` computes downstream truth and loss attribution when inputs exist, and operator-web picks pipeline resolves effective corrected settlement instead of raw settlement rows. Accepted Batch 1 through Batch 5 domain salvage foundation is present under `packages/domain/src/market`, `features`, `models`, `signals`, `bands`, `calibration`, `scoring`, `outcomes`, `evaluation`, `edge-validation`, `rollups`, `system-health`, `risk`, and `strategy`. 491/491 tests pass. All gates pass.

Week 16 scope:
- Runtime integration: settlement downstream truth + loss attribution wired into API and operator-web
- Batch 1: `market`, `features`, `models`, `signals` foundation accepted
- Batch 2: `bands`, `calibration`, `scoring` foundation accepted
- Batch 3: `outcomes`, `evaluation`, `edge-validation`, plus `market-reaction` foundation accepted
- Batch 4: `rollups`, `baseline-roi`, and `system-health` foundation accepted
- Batch 5: `risk` and `strategy` foundation accepted

**Week 15 closed 2026-03-21.** Probability & devig math salvage. 128/128 tests pass. Code audit clean. Math equivalence confirmed. Independent verification PASS.

Week 15 selectively salvaged the pure probability, devig, and calibration math from `unit-talk-production/packages/intelligence/src/probability/` into V2 under `packages/domain/src/probability/`. Three source files: `devigConsensus.ts` → `devig.ts`, `probabilityLayer.ts` → `probability-layer.ts`, `calibrationCompute.ts` → `calibration.ts`. All functions pure computation — no DB, no I/O, no side effects. 28 new tests. 18 formulas verified identical to old canonical source. No runtime code changed.

**Week 14** closed 2026-03-21. Verification control plane salvage. 100/100 tests pass. Code audit clean. No runtime changes.

**Week 13** closed 2026-03-21. Operator trader-insights health. 87/87 tests pass. Live snapshot verified against real DB (10/10 checks PASS). Three channels, three monitoring sections.

**Week 12** closed 2026-03-21. Settlement hardening complete. 83/83 tests pass.

**Week 11** closed 2026-03-21. 11A + 11B both complete. `discord:trader-insights` live in real channel `1356613995175481405`. Independent verification PASS. No rollback trigger.

## Authority Links

- **Status source of truth**: `docs/06_status/status_source_of_truth.md` - kill conditions, routing state, weekly status
- **Docs authority map**: `docs/05_operations/docs_authority_map.md` - tier assignments and conflict resolution
- Active roadmap: `docs/04_roadmap/active_roadmap.md`
- Operating model: `docs/05_operations/delivery_operating_model.md`
- Week 6 execution contract: `docs/05_operations/week_6_execution_contract.md`
- Week 7 Best Bets activation: `docs/05_operations/week_7_best_bets_activation.md`
- Week 7 artifact index: `docs/06_status/week_7_artifact_index.md`
- Settlement architectural contract: `docs/02_architecture/contracts/settlement_contract.md`
- Settlement planning: `docs/05_operations/settlement_planning.md`
- Week 8 readiness review: `docs/05_operations/week_8_settlement_readiness_review.md`
- Week 8 execution contract: `docs/05_operations/week_8_settlement_runtime_contract.md`
- Week 9 contract: `docs/05_operations/week_9_full_lifecycle_contract.md`
- Week 9 proof template: `docs/06_status/week_9_full_lifecycle_proof_template.md`
- Week 9 failure note template: `docs/06_status/week_9_failure_note_template.md`
- Week 9 readiness decision: `docs/05_operations/week_9_readiness_decision.md`
- **Week 10 contract**: `docs/05_operations/week_10_operator_command_center_contract.md`
- Trader-insights graduation criteria: `docs/05_operations/trader_insights_graduation_criteria.md`
- **Week 11 contract**: `docs/05_operations/week_11_trader_insights_activation.md`
- Week 11 proof template: `docs/06_status/week_11_proof_template.md`
- Week 11 failure/rollback template: `docs/06_status/week_11_failure_rollback_template.md`
- **Week 12 contract**: `docs/05_operations/week_12_settlement_hardening_contract.md`
- Week 12 proof template: `docs/06_status/week_12_proof_template.md`
- Week 12 failure/rollback template: `docs/06_status/week_12_failure_rollback_template.md`
- **Week 13 contract**: `docs/05_operations/week_13_operator_trader_insights_health_contract.md`
- Week 13 proof template: `docs/06_status/week_13_proof_template.md`
- Week 13 failure/rollback template: `docs/06_status/week_13_failure_rollback_template.md`
- **Week 14 contract**: `docs/05_operations/week_14_verification_control_plane_salvage_contract.md`
- Week 14 proof template: `docs/06_status/week_14_proof_template.md`
- Week 14 failure/rollback template: `docs/06_status/week_14_failure_rollback_template.md`
- **Week 15 contract**: `docs/05_operations/week_15_probability_devig_salvage_contract.md`
- Week 15 proof template: `docs/06_status/week_15_proof_template.md`
- Week 15 failure/rollback template: `docs/06_status/week_15_failure_rollback_template.md`
- **Week 16 contract**: `docs/05_operations/week_16_settlement_downstream_loss_attribution_contract.md`
- **Week 18 contract**: `docs/05_operations/week_18_domain_integration_layer_contract.md`
- Week 16 proof template: `docs/06_status/week_16_proof_template.md`
- Week 16 failure note template: `docs/06_status/week_16_failure_note_template.md`
- Week 16 closeout checklist: `docs/06_status/week_16_closeout_checklist.md`
- Migration ledger: `docs/05_operations/migration_ledger.md`
- System snapshot: `docs/06_status/system_snapshot.md`
- Next build order: `docs/06_status/next_build_order.md`

## Completed In This Workspace

- Created monorepo root files and shared package wiring
- Ratified core contracts and operating docs
- Seeded Notion and Linear operating structures
- Brought Supabase live with verified generated types
- Implemented submission -> lifecycle -> outbox -> worker -> receipt -> audit flow
- Proved the first live Discord canary post
- Added canary-safe Discord embed formatting
- Added a read-only operator web surface for health and recent operational state
- Proved a fresh live canary post through the embed path
- Confirmed operator snapshot visibility against the live database
- Replaced the smart-form placeholder with a real HTML intake surface and API handoff
- Hardened operator-web with outbox status/target filtering (`?outboxStatus=`, `?target=`, `?since=` on `/api/operator/snapshot`), incident banner on degraded/down health signals, and `cancelled` run detection as degraded worker state
- Hardened smart-form governance: source is always `smart-form` regardless of form input; request body size limit (default 64 KB) enforced before reading
- Added smart-form browser UX: invalid submissions now re-render with field-aware feedback, and successful submissions show a confirmation page with submission/pick IDs instead of raw JSON
- Completed UTV2-OPS-04: DB-side outbox filtering, incident triage section in HTML dashboard, and richer operator incident visibility
- Added canary-readiness evidence to operator-web: recent sent/failure/dead-letter counts, latest receipt/message markers, and explicit blockers for graduation visibility
- Cleared M3/M4 milestone tracking debt: UNI-130 (PIPE-02) links to M3, UNI-131 (LIFE-02) links to M4, both Done
- Evaluated `discord:best-bets` against the live operator snapshot and graduation criteria: the result is GO
- Sent the first live `discord:best-bets` preview through the worker while mapping the target to the canary channel for safe review
- Sent the first real-channel `discord:best-bets` post and recorded the initial proof bundle in `docs/06_status/system_snapshot.md`
- Week 7 monitoring window passed - no rollback trigger fired - Week 7 formally closed 2026-03-20
- Implemented the Week 8 settlement runtime contract, schema alignment, canonical write path, additive correction path, manual-review path, operator settlement visibility, and settlement tests
- Captured the first real posted-to-settled proof through `POST /api/picks/:id/settle` and recorded the exact runtime evidence in `docs/06_status/system_snapshot.md`
- Executed the Week 9 full lifecycle proof (submission → settled) and independently verified all 23 proof fields from the live DB — Week 9 closed 2026-03-20
- Delivered Week 10 Operator Command Center: `bestBets` channel health section, `picksPipeline` view, `GET /api/operator/picks-pipeline` endpoint, `OperatorSnapshot` interface extended, `trader_insights_graduation_criteria.md` ratified, 62/62 tests pass, independent verification complete — Week 10 closed 2026-03-20
- Delivered Week 11 trader-insights activation: schema migration 007, dual-policy eager evaluation, generalized routing gate, `discord:trader-insights` live in `1356613995175481405`, 72/72 tests, independent verification PASS — Week 11 closed 2026-03-21
- Delivered Week 12 settlement hardening: manual review two-phase resolution, multi-hop correction chains, operator settlement history (status + corrects_id), HTML labels, feed settlement explicitly blocked, 83/83 tests, independent verification PASS — Week 12 closed 2026-03-21
- Delivered Week 13 operator trader-insights health: `traderInsights: ChannelHealthSummary` in OperatorSnapshot, "Trader Insights Health" HTML card, 4 new tests, live snapshot verified (10/10 checks PASS), 87/87 tests — Week 13 closed 2026-03-21
- Delivered Week 14 verification control plane salvage: `packages/verification` with scenarios, run-history, archive modules; 5 V2-native scenarios; RunStore JSONL + atomic index; 2 archive sources + 2 replay packs; 2 JSONL fixtures; CLI query surface; 13 new tests; 100/100 total; code audit clean — Week 14 closed 2026-03-21
- Delivered Week 15 probability & devig math salvage: `packages/domain/src/probability/` with devig.ts, probability-layer.ts, calibration.ts + index.ts; all ported from `packages/intelligence/src/probability/`; 28 new tests (12 + 9 + 7); 128/128 total; math equivalence confirmed (18 formulas); code audit clean (0 violations); deterministic output verified — Week 15 closed 2026-03-21
- Delivered Week 16 settlement downstream & loss attribution foundation: `packages/domain/src/outcomes/` with outcome-resolver.ts, loss-attribution.ts, settlement-downstream.ts + index.ts; outcome-resolver and loss-attribution ported from `unit-talk-production/apps/api/src/analysis/outcomes/`; settlement-downstream is V2-native; 40 new tests; code audit clean (0 violations)
- Wired Week 16 outcomes into real runtime: `apps/api/src/settlement-service.ts` now computes canonical downstream settlement truth and loss attribution bundle, `apps/api/src/controllers/settle-pick-controller.ts` returns that downstream bundle on the canonical settlement API path, and `apps/operator-web/src/server.ts` uses effective corrected settlement truth for picks pipeline rendering; 172/172 total tests pass
- Accepted additional Week 16 Batch 1 domain salvage foundation: 29 new files across `packages/domain/src/market`, `features`, `models`, and `signals`; pure computation only; 82 additional tests; all repo gates pass
- Accepted additional Week 16 Batch 2 domain salvage foundation: 18 new files across `packages/domain/src/bands`, `calibration`, and `scoring`; pure computation only; 54 additional tests; `packages/domain/src/calibration` intentionally not re-exported from top-level domain index to avoid collision with `packages/domain/src/probability/calibration.ts`
- Accepted additional Week 16 Batch 3 domain salvage foundation: 16 new files across `packages/domain/src/outcomes`, `evaluation`, `edge-validation`, plus `packages/domain/src/market/market-reaction.ts`; pure computation only; 56 additional tests; `packages/domain/src/evaluation` intentionally not re-exported from top-level domain index to avoid naming collisions with existing probability/calibration score helpers
- Accepted additional Week 16 Batch 4 domain salvage foundation: 12 new files across `packages/domain/src/rollups`, `packages/domain/src/system-health`, and `packages/domain/src/outcomes/baseline-roi.ts`; 60 additional tests; `packages/domain/src/index.ts` now exports `rollups` and `system-health`, and `packages/domain/src/outcomes/index.ts` now exports `baseline-roi`
- Accepted additional Week 16 Batch 5 domain salvage foundation: 10 new files across `packages/domain/src/risk` and `packages/domain/src/strategy`; 67 additional tests; `packages/domain/src/index.ts` now exports `risk`, while `strategy` remains intentionally commented out from the top-level index until the `americanToDecimal` naming collision is resolved cleanly

- Delivered Week 18 domain integration layer: `apps/api/src/domain-analysis-service.ts` computes implied probability (via `americanToImplied`), edge (vs submitter confidence), and Kelly fraction (via `computeKellyFraction`) at submission time; `apps/api/src/submission-service.ts` enriches `pick.metadata.domainAnalysis` before persistence; fail-open for picks without odds; 11 new tests; 502/502 total — Week 18 closed 2026-03-21

## Next Recommended Moves

Week 18 closed. First domain modules wired into real API submission path.

**Not yet ported (future work):** Offer Fetch, DeviggingService (multi-book consensus service wrapper), Risk Engine (bankroll-aware service wrapper), GradingAgent scoring, Observation Hub, Lab/Backtest, Strategy Simulation. Note: the pure computation cores for Kelly/Risk Sizing, devig math, probability layer, calibration, strategy, and bankroll simulation are already ported — only the service wrappers and deeper integration layers remain.

**Next recommended work:** Wire scoring weights, calibration, or edge-validation into promotion scoring; build Offer Fetch service wrapper for multi-book consensus at submission; or deepen settlement enrichment with scoring/calibration. Define and ratify a Week 19 contract before beginning.

Keep `discord:canary` active permanently. Do not change `discord:best-bets` or `discord:trader-insights` routing.
