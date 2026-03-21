# Week 15 — Probability & Devig Math Salvage Contract

## Metadata

| Field | Value |
|---|---|
| Week | 15 |
| Title | Probability & Devig Math Salvage |
| Status | Ratified |
| Ratified | 2026-03-21 |
| Authority | This document |
| Baseline | 100/100 tests, `pnpm verify` clean (Week 14 closed) |

## Objective

Selectively salvage the **pure probability, devig, and calibration math** from `unit-talk-production/packages/intelligence/src/probability/` into V2 under `packages/domain/src/probability/`. All three source files are pure computation — zero I/O, zero side effects, zero DB access. They land in `packages/domain` because V2 already keeps core business logic there.

This is selective salvage under V2 architecture, not wholesale import. The old `packages/intelligence` is reference material only. Every function and type is adapted to V2 conventions.

## Salvage Reference Map

### Source locations (old system — reference only)

| Old File | Content | Decision |
|---|---|---|
| `packages/intelligence/src/probability/devigConsensus.ts` | `americanToImplied`, `calculateOverround`, `proportionalDevig`, `powerDevig`, `shinDevig`, `applyDevig`, `calculateBookWeight`, `computeConsensus`, `calculateEdge`, `calculateCLVProb` + types (`DevigMethod`, `BookOffer`, `ConsensusResult`, `EdgeResult`, etc.) | **SALVAGE** → `devig.ts` |
| `packages/intelligence/src/probability/probabilityLayer.ts` | `computeUncertainty`, `computeConfidenceFactor`, `computeDynamicCap`, `computePFinal`, `computeCLVForecast`, `computeProbabilityLayer` + types (`ProbabilityInput`, `ProbabilityOutput`, `ExplanationPayload`, etc.) | **SALVAGE** → `probability-layer.ts` |
| `packages/intelligence/src/probability/calibrationCompute.ts` | `computeBrierScore`, `computeLogLoss`, `computeReliabilityBuckets`, `computeECE`, `computeMCE`, `computeCalibrationMetrics` + types (`PredictionOutcome`, `ReliabilityBucket`, `CalibrationMetrics`) | **SALVAGE** → `calibration.ts` |
| `apps/api/src/lib/probability/__tests__/devigConsensus.test.ts` | 700+ lines of devig/consensus tests | **SALVAGE** (adapt) → `devig.test.ts` |
| `apps/api/src/lib/probability/__tests__/probabilityLayer.test.ts` | Probability layer tests | **SALVAGE** (adapt) → `probability-layer.test.ts` |

### Rejected (NOT ported in Week 15)

| Old File | Reason |
|---|---|
| `apps/api/src/lib/probability/offerFetch.ts` | Supabase-coupled I/O — not pure math |
| `apps/api/src/services/risk/KellySizer.ts` | Risk/sizing concern — not in `packages/intelligence`, separate future slice |
| `apps/api/src/agents/GradingAgent/scoring/expectedValue.ts` | Agent-coupled scoring — not pure math |
| `apps/api/src/services/risk/` (full directory) | Runtime services with exposure/drawdown state |
| Any `apps/api/src/lib/probability/` local copy | API holds local copies; canonical source is `packages/intelligence` |
| Old `packages/intelligence` package shell | Not porting the package — only the 3 probability files into `packages/domain` |

## V2 Destination

All files land under the existing `packages/domain` package:

```
packages/domain/src/probability/      NEW DIRECTORY
├── devig.ts                           from devigConsensus.ts
├── devig.test.ts                      from devigConsensus.test.ts (adapted)
├── probability-layer.ts               from probabilityLayer.ts
├── probability-layer.test.ts          new tests
├── calibration.ts                     from calibrationCompute.ts
├── calibration.test.ts                new tests
└── index.ts                           re-exports
```

`packages/domain/src/index.ts` gains one line: `export * from './probability/index.js';`

No new package. No new `tsconfig.json` reference. No new `package.json` dependency.

## In-Scope Deliverables

### Slice 1 — Devig & Consensus (`devig.ts`)

Port from `devigConsensus.ts`:

**Functions:**
- `americanToImplied(odds: number): number` — American odds → implied probability
- `calculateOverround(sideA: number, sideB: number): number` — sum of implied probabilities
- `proportionalDevig(sideA: number, sideB: number): DevigResult | null` — P_fair = P_implied / overround
- `powerDevig(sideA: number, sideB: number, k?: number): DevigResult | null` — P_fair = P^k / Σ(P^k)
- `shinDevig(sideA: number, sideB: number): DevigResult | null` — falls back to proportional (v1)
- `applyDevig(sideA: number, sideB: number, method: DevigMethod): DevigResult | null` — method dispatcher
- `calculateBookWeight(profile, liquidity, quality): BookWeightBreakdown` — multi-factor book weighting
- `computeConsensus(offers: BookOffer[], method?: DevigMethod): ConsensusResult` — weighted multi-book consensus (fail-closed, ≥2 books)
- `calculateEdge(pModel: number, pMarket: number, decimalOdds: number): EdgeResult` — edge + EV
- `calculateCLVProb(entryDevigProb: number, closingDevigProb: number): number` — CLV in probability space
- `roundTo(value: number, decimals: number): number` — deterministic rounding utility

**Types:**
- `DevigMethod`, `BookProfile`, `LiquidityTier`, `DataQuality`
- `BookOffer`, `DevigedBook`, `BookWeightBreakdown`
- `ConsensusResultOk`, `ConsensusResultFail`, `ConsensusResult`, `ConsensusFailReason`
- `EdgeResult`

**Constants:**
- `MIN_BOOKS_FOR_CONSENSUS`, `PROBABILITY_MODEL_VERSION`
- `LIQUIDITY_WEIGHTS`, `SHARP_WEIGHTS`, `DATA_QUALITY_WEIGHTS`

### Slice 2 — Probability Layer (`probability-layer.ts`)

Port from `probabilityLayer.ts`:

**Functions:**
- `computeUncertainty(factors: UncertaintyFactors): number` — multi-factor uncertainty (0–1)
- `computeConfidenceFactor(booksUsed, bookSpread, featureCompleteness): number` — trust multiplier
- `computeDynamicCap(booksUsed, bookSpread, params?): { cap, reason }` — bounded adjustment cap
- `computePFinal(confidence, pMarketDevig, uncertainty, confidenceFactor?, dynamicCap?): PFinalResult` — market-anchored final probability
- `computeCLVForecast(edge, marketType, hoursToStart): number` — predicted line movement
- `computeProbabilityLayer(input: ProbabilityInput): ProbabilityOutput` — fail-closed orchestrator

**Types:**
- `UncertaintyFactors`, `ExplanationPayload`, `SyndicateLayerParams`
- `ProbabilityInput`, `ProbabilityOutputOk`, `ProbabilityOutputFail`, `ProbabilityOutput`
- `ProbabilityFailReason`, `PFinalResult`

**Constants:**
- `UNCERTAINTY_THRESHOLDS`, `MARKET_DELTA_PARAMS`, `CLV_FORECAST_PARAMS`

### Slice 3 — Calibration (`calibration.ts`)

Port from `calibrationCompute.ts`:

**Functions:**
- `computeBrierScore(predictions: PredictionOutcome[]): number` — mean squared error
- `computeLogLoss(predictions: PredictionOutcome[]): number` — cross-entropy loss
- `computeReliabilityBuckets(predictions, bucketWidth?): ReliabilityBucket[]` — calibration diagram data
- `computeECE(buckets, totalSamples): number` — expected calibration error
- `computeMCE(buckets): number` — maximum calibration error
- `computeCalibrationMetrics(predictions, modelVersion, probModelVersion, bucketWidth?): CalibrationMetrics` — full metrics bundle

**Types:**
- `PredictionOutcome`, `ReliabilityBucket`, `CalibrationMetrics`

### Slice 4 — Tests

Colocated test files using `node:test` + `node:assert/strict` (V2 pattern):

- `devig.test.ts` — americanToImplied, overround, proportional/power devig, consensus fail-closed gates, sharp weighting, order-independence, determinism, edge, CLV
- `probability-layer.test.ts` — uncertainty factors, confidence→delta mapping (neutral = 0), pFinal market-anchored, CLV forecast, full orchestrator fail-closed
- `calibration.test.ts` — Brier score, log loss, reliability buckets, ECE, MCE, full metrics bundle

Target: ≥20 new tests across 3 test files.

### Slice 5 — Integration

- Create `packages/domain/src/probability/index.ts` re-exporting all modules
- Update `packages/domain/src/index.ts` to add `export * from './probability/index.js';`
- Root `package.json` test command updated to include the 3 new test files
- Internal import chain: `probability-layer.ts` imports from `./devig.js`; `calibration.ts` imports `roundTo` from `./devig.js`

## Adaptation Points

1. **Strip old sprint references** — remove `// Sprint: INTELLIGENCE-PROBABILITY-*` and `// Updated: SPRINT-024-*` comments
2. **Strip old eslint-disable comments** — only re-add if V2 lint config actually requires them
3. **Internal imports** — change `'./devigConsensus'` to `'./devig.js'` (V2 uses `.js` extensions for ESM)
4. **No old package shell** — these files are NOT `packages/intelligence`, they are `packages/domain/src/probability/`
5. **Keep all function signatures identical** — the math must not change
6. **CLV included** — both `calculateCLVProb` (devig) and `computeCLVForecast` (probability-layer) come over as-is

## Non-Goals

| Item | Reason |
|---|---|
| New `packages/probability` or `packages/intelligence` package | Files go into existing `packages/domain` |
| Kelly criterion / risk sizing | Not in `packages/intelligence`; separate future slice |
| Expected value (agent-coupled) | In GradingAgent scoring, not pure math package |
| Offer fetch / DeviggingService | Supabase-coupled I/O |
| Old database migrations | Not applicable — pure math |
| Old runtime routes or services | Not pure math |
| Old agents | Runtime coupling |
| Command-center work | Out of scope |
| Channel work | Out of scope |
| Settlement changes | Out of scope |
| Schema migrations | No DB in this scope |
| Runtime code changes to existing apps | No changes to apps/api, apps/worker, apps/operator-web, apps/smart-form routes/services |

## Close Criteria

All of the following must be true to close Week 15:

1. `packages/domain/src/probability/` directory exists with: `devig.ts`, `probability-layer.ts`, `calibration.ts`, `index.ts`
2. `packages/domain/src/index.ts` re-exports from `./probability/index.js`
3. All 3 test files exist and pass: `devig.test.ts`, `probability-layer.test.ts`, `calibration.test.ts`
4. Root `package.json` test command includes all 3 new test files
5. `pnpm test` ≥ 120 (100 + ≥20 new)
6. `pnpm test:db` = 1/1
7. `pnpm lint` clean
8. `pnpm type-check` clean
9. `pnpm build` clean
10. Code audit clean:
    - No imports from `unit-talk-production` paths
    - No Supabase or DB imports in probability directory
    - No side effects (all functions pure)
    - Internal imports use `./devig.js` (not `./devigConsensus`)
    - No rejected modules present (offerFetch, KellySizer, expectedValue agent code)
11. No changes to existing app runtime code (apps/api, apps/worker, apps/operator-web, apps/smart-form routes/services)
12. `probability-layer.ts` successfully imports from `./devig.js`; `calibration.ts` successfully imports `roundTo` from `./devig.js`
13. Math correctness: at least one deterministic fixed-input test per module confirming known output values
14. Independent verification passes

## Rollback Condition

If any close criterion cannot be met:
1. Record the failure in `docs/06_status/week_15_failure_rollback_template.md`
2. Delete `packages/domain/src/probability/` directory entirely
3. Revert `packages/domain/src/index.ts` to remove probability re-export
4. Remove probability test files from root `package.json` test command
5. Confirm `pnpm test` = 100/100 (Week 14 baseline)
6. Confirm `pnpm verify` clean

## Formulas Reference

These are the core mathematical formulas being salvaged. Implementation must match these exactly:

| Formula | Definition | Source |
|---|---|---|
| Implied probability (negative) | `\|odds\| / (\|odds\| + 100)` | devig |
| Implied probability (positive) | `100 / (odds + 100)` | devig |
| Overround | `P_sideA + P_sideB` | devig |
| Proportional devig | `P_fair = P_implied / overround` | devig |
| Power devig | `P_fair = P^k / Σ(P^k)` | devig |
| Book weight | `w = liquidityWeight × sharpWeight × qualityWeight` | devig |
| Consensus | `P_consensus = Σ(w × P_fair) / Σ(w)` | devig |
| Edge | `edge = P_model - P_market` | devig |
| EV | `EV = P × (decimalOdds - 1) - (1 - P)` | devig |
| CLV probability | `CLV = closingDevigProb - entryDevigProb` | devig |
| Uncertainty | weighted sum of 5 factors, clamped [0, 1] | probability-layer |
| Confidence→delta | maps [0, 10] to [-MAX_DELTA, +MAX_DELTA], neutral at 5 | probability-layer |
| P_final | `p_market + delta × confFactor × (1 - uncertainty)`, clamped [0.01, 0.99] | probability-layer |
| CLV forecast | `edge × 0.5 × marketAdj × timeDecay`, clamped [-1, 1] | probability-layer |
| Brier score | `mean((outcome - predicted)^2)` | calibration |
| Log loss | `-mean(y × log(p) + (1-y) × log(1-p))` | calibration |
| ECE | `Σ(\|bucket\| / n × \|avgPredicted - observedRate\|)` | calibration |
| MCE | `max(\|avgPredicted - observedRate\|)` | calibration |
