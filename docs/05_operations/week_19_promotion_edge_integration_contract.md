# Week 19 Contract — Promotion Edge Integration

## Objective

Consume Week 18's submission-time domain analysis in the promotion scoring pipeline. When the submitter does not provide an explicit `promotionScores.edge` value, and domain analysis computed a real mathematical edge from odds, use that data-driven edge instead of the generic confidence fallback.

## Sprint Name

`SPRINT-WEEK19-PROMOTION-EDGE-INTEGRATION`

## Scope

### In Scope

1. **Promotion service enrichment** (`apps/api/src/promotion-service.ts`):
   - Modify `readPromotionScoreInputs()` to check `metadata.domainAnalysis.edge` as a fallback before confidence
   - Add a conversion function mapping raw mathematical edge (typically -0.5 to +0.5) to the 0-100 promotion score scale
   - Priority order: explicit `promotionScores.edge` > domain analysis edge > confidence-based fallback
   - No changes to the promotion policy definitions, thresholds, or evaluation logic

2. **Tests** (in existing or new test file):
   - Verify explicit `promotionScores.edge` still wins when present
   - Verify domain analysis edge is used when `promotionScores.edge` is absent but domain analysis is available
   - Verify confidence fallback still works when both are absent
   - Verify the edge-to-score conversion produces expected values for known inputs

### Out of Scope

- Changing promotion policy thresholds (`minimumEdge`, `minimumTrust`, `minimumScore`)
- Changing score weights (`bestBetsScoreWeights`)
- Feeding domain analysis into trust, readiness, uniqueness, or boardFit inputs
- Feeding Kelly fraction into any promotion input
- Changing settlement, distribution, or submission paths
- Schema changes
- New dependencies

## Edge-to-Score Conversion Design

Raw domain analysis edge is `confidence - impliedProbability`, typically ranging -0.5 to +0.5.

Conversion: `edgeScore = clamp(50 + rawEdge * 400, 0, 100)`

Examples:
| Raw Edge | Score | Meaning |
|----------|-------|---------|
| +0.10 | 90 | Strong positive edge |
| +0.05 | 70 | Moderate positive edge |
| +0.02 | 58 | Slight positive edge |
| 0.00 | 50 | No edge |
| -0.05 | 30 | Moderate negative edge |
| -0.10 | 10 | Strong negative edge |

For trader-insights (threshold 85): requires raw edge >= 0.0875 (~8.75% mathematical edge).
For best-bets (threshold 0): any edge passes.

## Acceptance Criteria

1. Explicit `promotionScores.edge` values are unchanged in behavior
2. When domain analysis edge is available and `promotionScores.edge` is absent, the converted score is used
3. When neither is available, confidence-based fallback is used (unchanged)
4. Edge-to-score conversion is deterministic and produces expected values
5. All existing tests continue to pass
6. New tests verify the three-tier fallback behavior
7. All 6 gates pass: test, test:db, lint, type-check, build, verify

## Architecture Constraints

- Changes confined to `apps/api/src/promotion-service.ts` (consumer)
- No changes to `apps/api/src/domain-analysis-service.ts` (producer)
- No changes to `packages/domain/` or `packages/contracts/`
- The conversion function is pure computation (no I/O)

## Codex Parallel Task

"Promotion Score Sensitivity Matrix" — generate a read-only documentation table showing how different edge/trust/confidence input combinations map to final promotion scores under both policies (best-bets and trader-insights), using the current weight configuration.

## Non-Goals

- Replacing confidence-based trust fallback with domain analysis
- Using Kelly fraction for sizing-aware promotion decisions
- Changing the promotion evaluation logic in `packages/domain/src/promotion.ts`
- Any multi-book or calibration integration

## Ratification

This contract is ratified as part of the Week 19 sprint execution.
