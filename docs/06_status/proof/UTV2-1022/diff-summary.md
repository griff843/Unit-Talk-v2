# UTV2-1022 Diff Summary

**Issue:** Implement `computeRiskScore()` per `RISK_VOLATILITY_STANDARD.md`
**Branch:** `codex/utv2-1022-implement-computeriskscore`
**Tier:** T2

## Files Changed

### New Files
- `packages/domain/src/risk-score.test.ts` — 10 unit tests for `computeRiskScore` and `calculateScore` risk modifier
- `.ops/sync/UTV2-1022.yml` — lane sync config
- `docs/06_status/proof/UTV2-1022/` — this proof bundle

### Modified Files

| File | Change |
|------|--------|
| `packages/domain/src/promotion.ts` | Added `RiskScoreResult` interface, `RISK_MODIFIER_WEIGHT=0.15`, `RISK_SCORE_VERSION='risk-v1'`, `computeRiskScore()` pure function, updated `calculateScore()` to apply risk modifier, wired risk gates into `evaluatePromotionEligibility()`, updated `replayPromotion()` for pre-v3 snapshot determinism |
| `packages/contracts/src/promotion.ts` | Extended `PromotionScoreInputs` with optional `riskScore`/`riskComponents` for replay determinism; extended `PromotionDecisionSnapshot.scoreInputs` with `riskScore`, `riskComponents`, `riskModifier` |
| `apps/api/src/promotion-service.ts` | Wired `computeRiskScore` into `evaluateAllPoliciesEagerAndPersist`, `buildSmartFormQualifiedResult`, `persistPromotionDecisionForPick` — persists `riskScore`, `riskComponents`, `riskModifier` in snapshot |
| `docs/05_operations/RISK_VOLATILITY_STANDARD.md` | Updated status from RATIFIED → SHIPPED, updated version-bump note to reflect deferred v2→v3 bump, added change history entry |
| `apps/api/src/golden-regression.test.ts` | Updated expected `promotionScore`/`promotionReason` for all 4 scenarios to reflect risk-modifier-adjusted values |
| `apps/api/src/model-registry.test.ts` | Updated expected score values for `calculateScore` weight tests to reflect risk modifier with absent kelly data |
| `apps/api/src/promotion-edge-integration.test.ts` | Updated test 27 to account for risk modifier score change |
| `apps/api/src/submission-service.test.ts` | Updated 5 borderline tests to add odds/confidence so `domainAnalysis.kellyFraction` is computed → risk modifier stays near 1.0 |
| `packages/domain/src/promotion-conviction.test.ts` | Updated borderline conviction=4 test to use higher edge score so modified total stays above 70 threshold |

## Key Design Decisions

1. **Kelly fail-closed**: absent Kelly data → `kellyScore=0`. This means picks without Kelly data get partial risk penalty (~15% score reduction). Picks with Kelly data from domain-analysis (`domainAnalysis.kellyFraction`) get proper Kelly score.

2. **Replay determinism**: `replayPromotion()` now injects `riskScore=100` (modifier=1.0) when replaying pre-v3 snapshots (no stored riskScore), preserving original decision semantics.

3. **Version bump deferred**: Policy versions remain at `best-bets-v2`, `trader-insights-v2`, `exclusive-insights-v2`. The v2→v3 bump is deferred to avoid snapshot replay migration.

4. **`domainAnalysis.kellyFraction` fallback**: `computeKellyScore` reads from both `metadata.kellySizing.fractional_kelly` and `metadata.domainAnalysis.kellyFraction`, the latter computed by `domain-analysis-service` from odds+confidence when provider offers exist.
