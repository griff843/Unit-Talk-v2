---
schema: evidence-bundle-v1
issue: UTV2-985
tier: T1
branch: claude/utv2-985-fix-domain-analysis-real-edge-wiring
author: claude
---

# UTV2-985 Evidence Bundle — Edge Provenance Wiring & Fail-Closed Promotion

## Summary

The root cause: `readDomainAnalysisEdgeScore()` allowed confidence-delta picks (92.4% of
all picks per 12,043-pick audit) to score identically to market-backed picks in the
promotion engine. This fix makes confidence-delta contribution zero in promotion scoring.

## What Was Fixed

### Root Cause

`readPromotionScoreInputs()` called `readDomainAnalysisEdgeScore(pick.metadata)` which
reads `domainAnalysis.edge` — a value computed from `confidence - impliedFromOdds`
(pure confidence delta, no market data). This edge proxy inflated promotion scores for
92.4% of picks identically to how real Pinnacle/consensus/SGO edge would.

### Fix

1. **`readMarketBackedEdgeScore()`** — new function that returns `null` for confidence-delta
   picks (when `realEdgeSource === 'confidence-delta'` or no market data present). Callers
   use `marketBackedEdgeScore ?? 0` — confidence-delta contribution is zero.

2. **`EdgeProvenance`** on every pick — `computeRealEdge()` now returns:
   - `method`: `'market-devigged'` or `'confidence-delta'`
   - `providerCoverageState`: `'pinnacle' | 'consensus' | 'sgo' | 'single-book' | 'none'`
   - `fallbackReason`: set when confidence-delta is used

3. **Persisted in pick metadata** — `edgeProvenance` written to `pick.metadata` by
   `submission-service.ts` on every submission with odds + confidence.

4. **Promotion snapshot** — `edgeMethod` and `providerCoverageState` added to
   `PromotionDecisionSnapshot.scoreInputs` for every evaluation.

## Files Changed

| File | Change |
|------|--------|
| `packages/contracts/src/promotion.ts` | Added `EdgeMethod`, `ProviderCoverageState`, `EdgeFallbackReason` types; added `edgeMethod`/`providerCoverageState` to `PromotionDecisionSnapshot.scoreInputs` |
| `apps/api/src/real-edge-service.ts` | Added `EdgeProvenance` interface; `computeRealEdge()` returns provenance on all 5 tiers |
| `apps/api/src/submission-service.ts` | Persists `edgeProvenance` in pick metadata |
| `apps/api/src/promotion-service.ts` | `readMarketBackedEdgeScore()` exported; `readPromotionScoreInputs()` uses `marketBackedEdgeScore ?? 0` (fail-closed) |
| `scripts/ops/edge-coverage-report.ts` | New operator tool — queries picks, computes edge provenance breakdown vs audit baseline |

## Test Coverage

### New Tests (7)
- `readMarketBackedEdgeScore returns null when no market data (confidence-delta only)`
- `readMarketBackedEdgeScore returns score when Pinnacle real edge present`
- `readMarketBackedEdgeScore returns score when top-level market-backed realEdge present`
- `readMarketBackedEdgeScore ignores top-level realEdge when source is confidence-delta`
- `evaluateAndPersistBestBetsPromotion uses edge=0 for confidence-delta-only picks`
- `evaluateAndPersistBestBetsPromotion uses real edge score when market data is present`
- `computeRealEdge returns provenance with method and providerCoverageState`

### Updated Tests (6)
Tests that previously documented the confidence-delta masquerade now assert the correct
fail-closed behavior (suppressed when no market-backed edge + no explicit edge score).

### Total Pass Count
- `promotion-edge-integration.test.ts`: 54/54 ✓
- `submission-service.test.ts`: 72/72 ✓
- `golden-regression.test.ts`: 5/5 ✓ (NHL scenario updated: no-odds pick correctly suppressed)
- Full `pnpm verify`: all tests pass

## Behavioral Change (PM-Required)

**Before:** Confidence-delta picks received `edge = scoreRawEdge(domainAnalysis.edge)`, which
could be as high as 100 for a pick with confidence=0.65, odds=+150 (edge=+0.25). This pick
would qualify for exclusive-insights at score 92.4.

**After:** Confidence-delta picks receive `edge = 0`. Same pick: score = 57.4 → suppressed.
Picks can only qualify via:
1. Explicit operator `promotionScores.edge` override, OR
2. Real market-backed edge (Pinnacle/consensus/SGO/single-book provider offer present)

## Edge Coverage Baseline (PM-Required Comparison)

Audit baseline from 12,043 historical picks:
- Real edge (market-devigged): **0.2%** of picks
- Confidence-delta (proxy): **92.4%** of picks
- Other/unknown: **7.4%** of picks

Post-fix: All existing picks in DB still have their historical `realEdgeSource`. New picks
submitted after this fix deploy will have `edgeProvenance` populated. The
`scripts/ops/edge-coverage-report.ts` tool queries live picks and computes current
breakdown vs this baseline. See `edge-coverage-report.json` for live DB output.

## Live DB Proof (`pnpm test:db`)

T1 verification: `pnpm test:db` output pasted below (last 30 lines).

```
> @unit-talk/v2@0.1.0 test:db C:\Dev\Unit-Talk-v2-main
> tsx --test apps/api/src/database-smoke.test.ts

✔ database repository bundle persists a submission and settlement when Supabase is configured (40224.5458ms)
✔ UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row (39075.4851ms)
✔ UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes (43187.3007ms)
✔ UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row (42521.0399ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (594.191ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 166264.2817
```

## R-level Compliance

```
Verdict: PASS
Changed files: 11
Rules matched: lifecycle-fsm, promotion-scoring
Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
```

R4 fault report is PM-gated (advisory only — not required for T1 merge gate).
