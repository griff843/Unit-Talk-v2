# UTV2-1204 Verification — Line Movement Double-Count Resolution (Option B)

## Summary

Removes line movement from the risk modifier path (path 1) in `computeRiskScore`.
Line movement now enters the promotion score exclusively through the edge/model-blend path
(`movement_score → signal_adjustment` in `model-blend.ts`), which is the authoritative path.

**PM Ruling:** Option B — edge/model blend is the sole authoritative path for line movement.

**Weight change (risk-v2):**
- Before: `varianceScore * 0.35 + kellyScore * 0.35 + lineMovementScore * 0.20 + dispersionScore * 0.10`
- After: `varianceScore * 0.45 + kellyScore * 0.45 + dispersionScore * 0.10`

`lineMovementScore` is retained in `components` as a backward-compat neutral marker (always 50) for stored snapshot replay.

## Evidence

**Branch SHA (pre-merge):** `95bf8de14c1b7e052994dfc09c2b09c9f9f1d7ed`

**Files changed:**
- `packages/domain/src/promotion.ts` — removed `computeLineMovementScore` from weighted sum; rebalanced weights; lineMovementScore always 50 (neutral marker)
- `apps/api/src/promotion-edge-integration.test.ts` — updated comment for risk formula; added UTV2-1204 regression test; fixed alert-agent test inputs to include explicit odds

**Tests updated to reflect new formula:**
- `packages/domain/src/risk-score.test.ts` — updated expected scores for risk-v2 weights; added UTV2-1204 regression test
- `apps/api/src/golden-regression.test.ts` — updated 3 golden scores reflecting weight rebalancing
- `apps/api/src/model-registry.test.ts` — updated 3 expected scores reflecting weight rebalancing

**pnpm verify result:** PASS — 113 tests, 113 pass, 0 fail

```
# tests 113
# suites 13
# pass 113
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

**pnpm type-check:** PASS — no TypeScript errors

**pnpm test:db — Not applicable: T2 lane**
```
# pass 0
# fail 0
# skipped 0
```

**R-level check:** `Verdict: PASS — no R-level artifacts required for this diff`

## Verification

**Regression test (UTV2-1204):** Verifies that a pick with favorable line movement (basisPointsDelta=+50) produces the same `riskScore` as a pick with adverse line movement (basisPointsDelta=-100). Both return `riskScore` 39 (with odds=-110 and default kelly/dispersion).

**lineMovementScore in components:** Always returns 50 (neutral marker) regardless of metadata, preserving backward compat with stored snapshot replay while removing the signal from the weighted computation.

**Backward compat:** The `lineMovementScore` field is retained in `RiskScoreResult.components` and `riskComponents` snapshots for replay compatibility. Pre-existing snapshots can be re-evaluated against the new formula without data loss.
