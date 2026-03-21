# Next Build Order

This file answers one question: what should happen next, in order.

## Immediate Rule

Do not remove `discord:canary` from live routing.

## Completed Items

All of the following are now done:
- Week 6 runtime promotion gate
- promotion persistence on `picks`
- additive `pick_promotion_history`
- persisted override path with audit/history
- promotion-specific runtime tests
- CI enforcement for `pnpm test` and `pnpm test:db`
- Week 7 controlled real-channel Best Bets activation (formally closed 2026-03-20)
- Week 8 settlement implementation: schema, write path, read path, first posted-to-settled proof (formally closed 2026-03-20)
- Week 9 full lifecycle proof: submission to settled, all 23 proof fields independently verified, anti-drift cleanup complete, readiness decision written (formally closed 2026-03-20)
- Week 10 Operator Command Center: `bestBets` channel health section, `GET /api/operator/picks-pipeline` endpoint, picks pipeline HTML view, `OperatorSnapshot` extended, `trader_insights_graduation_criteria.md` ratified, 62/62 tests, 13 independent verification checks passed (formally closed 2026-03-20)
- Week 11A Framework Generalization: `PromotionTarget` + `PromotionPolicy` extended, both policies evaluated at submission, routing gate generalized, delivery adapters target-aware, 72/72 tests pass (formally closed 2026-03-20)
- Week 11B pre-activation package: A4 (canary mechanism) + A6 (embed spec) resolved; activation contract section 11B addendum written; proof/rollback templates updated (2026-03-20)
- Week 11B Controlled Activation: `discord:trader-insights` live in real channel `1356613995175481405`; canary preview PASS; real-channel delivery PASS; independent verification PASS; Week 11 formally closed 2026-03-21
- Week 12 Settlement Hardening: manual review two-phase resolution, correction chain multi-hop, operator settlement history (status + corrects_id), HTML labels, feed settlement blocked; 83/83 tests, independent verification PASS; Week 12 formally closed 2026-03-21

## Current Priority Order

Week 18 closed. Domain integration layer complete. Next work requires a ratified Week 19 contract.

### Completed: Week 18 - Domain Integration Layer (CLOSED 2026-03-21)

First salvaged domain modules wired into real API submission path. `domain-analysis-service.ts` computes implied probability, edge, and Kelly sizing at submission time using `@unit-talk/domain` (probability/devig + risk/kelly-sizer). 502/502 tests. All gates pass.

### Completed: Week 17 - Git Baseline Ratification (CLOSED 2026-03-21)

First commit created from audited post-salvage repo state. `.gitignore` hardened. Status docs reconciled. All gates pass.

### Completed: Week 16 - Settlement Downstream & Loss Attribution + Full Domain Salvage (CLOSED 2026-03-21)

491/491 tests. Runtime integration: canonical settlement write path returns downstream truth, operator-web picks pipeline resolves effective corrected settlement. Batch 1 through Batch 5 pure-computation salvage accepted. Independent verification PASS.

### Completed: Week 15 - Probability & Devig Math Salvage (CLOSED 2026-03-21)

128/128 tests, 28 new tests, math equivalence confirmed, code audit clean, independent verification PASS.

### Completed: Week 14 - Verification Control Plane Salvage (CLOSED 2026-03-21)

100/100 tests, code audit clean, independent verification PASS.

### Completed: Week 13 - Operator Trader Insights Health (CLOSED 2026-03-21)

87/87 tests, live snapshot 10/10 checks PASS, independent verification PASS.

### Next Candidate Work (Not Yet Started — Requires Ratified Week 19 Contract)

1. Deeper domain integration: wire scoring weights, calibration, or edge-validation into promotion scoring
2. Offer Fetch service wrapper
3. DeviggingService integration layer (multi-book consensus at submission)
4. Risk Engine service integration (bankroll-aware sizing beyond Kelly fraction)
5. Observation Hub permanent control plane

## Do Not Start Without Planning

- `discord:game-threads` live routing
- `discord:strategy-room` live routing
- broad multi-channel expansion beyond Best Bets
- any new product surface

## Required Sync After Each Item

After each completed item:
- patch `docs/06_status/status_source_of_truth.md`
- patch `docs/06_status/current_phase.md`
- patch `docs/06_status/system_snapshot.md` if runtime reality changed
- update Notion checkpoint / weekly status
- update the corresponding Linear issue or milestone state
