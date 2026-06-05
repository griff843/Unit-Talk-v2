# UTV2-1204 Diff Summary

## Summary

**Issue:** Line movement signal double-counted in promotion score — contributed through both risk modifier (path 1) and model-blend edge (path 2) simultaneously.

**Fix (Option B):** Remove path 1 (risk modifier). Line movement enters exclusively through path 2 (model-blend/edge component via `movement_score → signal_adjustment` in `model-blend.ts`).

## Changes

### `packages/domain/src/promotion.ts`

1. **Removed** `computeLineMovementScore(metadata)` call from `computeRiskScore`
2. **Removed** `lineMovementScore * 0.20` from weighted sum
3. **Rebalanced weights** (risk-v2): `varianceScore * 0.45 + kellyScore * 0.45 + dispersionScore * 0.10`
4. **Removed** `computeLineMovementScore` function (dead code)
5. **Retained** `lineMovementScore: 50` in returned components as backward-compat neutral marker
6. **Updated** JSDoc to document Option B rationale
7. **Updated** `RISK_SCORE_VERSION` comment reference to risk-v2

### `apps/api/src/promotion-edge-integration.test.ts`

1. Updated risk formula comment (lines 393-401) to reflect risk-v2 weights and new riskScore=39
2. Added `odds: -110` to two alert-agent tests that were borderline-qualifying without explicit odds (neutral varianceScore=50 was insufficient with rebalanced weights)
3. Added regression test: `UTV2-1204: favorable lineMovement raises edge (model blend) but leaves riskScore unchanged`

### Consequential test updates (outside formal scope, required for green CI)

- `packages/domain/src/risk-score.test.ts` — updated expected composite scores (e.g., 41→39 for -110 baseline), hardblock test logic, added UTV2-1204 regression test
- `apps/api/src/golden-regression.test.ts` — updated 3 golden scores: nba-trader-insights-win (93.69→94.86), mlb-best-bets-push (76.14→75.50), nhl-confidence-correction (54.41→53.96)
- `apps/api/src/model-registry.test.ts` — updated 3 expected scores for best-bets/trader-insights/exclusive-insights policies

## R-Level Compliance

T2 modeling lane — Tier C (packages/domain/src/**). No R-level artifacts required. R-level check: PASS.

## Merge Order

This PR has no merge-order dependency.
