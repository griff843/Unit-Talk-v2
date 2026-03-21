# Week 15 Proof Template

## Metadata

| Field | Value |
|---|---|
| Week | 15 — Probability & Devig Math Salvage |
| Template status | Independent verification complete 2026-03-21 |
| Authority | `docs/05_operations/week_15_probability_devig_salvage_contract.md` |

---

## Pre-Implementation Gate

Before beginning Week 15 implementation, confirm:

| Check | Required | Result |
|---|---|---|
| `pnpm test` | 100/100 | 100/100 PASS (Week 14 baseline) |
| `pnpm test:db` | 1/1 | 1/1 PASS |
| `pnpm verify` | clean | clean |
| No existing `packages/domain/src/probability` | confirmed | confirmed (directory did not exist before Week 15) |

---

## Implementation Verification

### Slice 1 — Devig & Consensus (`devig.ts`)

| Check | Expected | Result |
|---|---|---|
| `americanToImplied()` converts negative and positive odds correctly | test passes | PASS — `-110→0.52381`, `110→0.47619` |
| `calculateOverround()` returns sum of implied probabilities | test passes | PASS — `0.52381+0.52381=1.04762` |
| `proportionalDevig()` returns fair probabilities summing to ~1.0 | test passes | PASS — `overFair+underFair=1` |
| `powerDevig()` returns deterministic normalized fair probabilities | test passes | PASS — k=1 matches proportional |
| `applyDevig()` dispatches to correct method | test passes | PASS — 4 methods verified |
| `computeConsensus()` with ≥2 valid books returns ok result | test passes | PASS — 3 books, ok=true, booksUsed=3 |
| `computeConsensus()` with <2 books returns fail-closed result | test passes | PASS — INSUFFICIENT_BOOKS |
| `computeConsensus()` weights sharp books higher than retail | confirmed | PASS — pinnacle.normalizedWeight > betmgm |
| `computeConsensus()` is order-independent (shuffled → same result) | confirmed | PASS — reversed offers same consensus |
| `calculateEdge()` returns edge, EV, evPercent | test passes | PASS — edge=0.05, ev=0.1, evPercent=10 |
| `calculateCLVProb()` returns correct CLV | test passes | PASS — CLV(0.52,0.56)=0.04 |
| Fail-closed: zero overround returns null | confirmed | PASS — proportionalDevig guard at line 121 |

### Slice 2 — Probability Layer (`probability-layer.ts`)

| Check | Expected | Result |
|---|---|---|
| `computeUncertainty()` returns value in [0, 1] | test passes | PASS — returns 0 for strong inputs |
| `computeConfidenceFactor()` returns value in [0, 1] | test passes | PASS — stronger > weaker |
| `computeDynamicCap()` returns cap with reason | test passes | PASS — cap ≥ 0.01, cap ≤ 0.06 |
| `computePFinal()` with neutral confidence (5.0) → delta = 0 → p_final ≈ p_market | test passes | PASS — pFinal=0.55, adjustmentRaw=0 |
| `computePFinal()` clamps to [0.01, 0.99] | confirmed | PASS — low=0.01, high=0.99 |
| `computeCLVForecast()` returns value in [-1, 1] | test passes | PASS — positive for +edge/points |
| `computeProbabilityLayer()` with valid input returns ok result | test passes | PASS — ok=true, explain payload present |
| `computeProbabilityLayer()` with <2 books returns fail-closed result | test passes | PASS — INSUFFICIENT_BOOKS |
| Imports from `./devig.js` (not `./devigConsensus`) | confirmed | PASS — line 11: `from './devig.js'` |
| `ExplanationPayload` includes reason_codes | confirmed | PASS — `reason_codes: string[]` at line 34 |

### Slice 3 — Calibration (`calibration.ts`)

| Check | Expected | Result |
|---|---|---|
| `computeBrierScore()` returns correct score on fixed fixture | test passes | PASS — 0.065 on 4-prediction fixture |
| `computeLogLoss()` returns correct loss on fixed fixture | test passes | PASS — 0.289909 on 4-prediction fixture |
| `computeReliabilityBuckets()` groups predictions correctly | test passes | PASS — ≥2 buckets, total count=4 |
| `computeECE()` returns expected calibration error | test passes | PASS — returns 0 for perfectly aligned |
| `computeMCE()` returns max calibration error | test passes | PASS — ≥0 |
| `computeCalibrationMetrics()` returns full bundle | test passes | PASS — sampleSize=4, winCount=2, lossCount=2 |
| Imports `roundTo` from `./devig.js` | confirmed | PASS — line 1: `import { roundTo } from './devig.js'` |

### Slice 4 — Integration

| Check | Expected | Result |
|---|---|---|
| `packages/domain/src/probability/index.ts` re-exports all 3 modules | present | PASS — exports calibration, devig, probability-layer |
| `packages/domain/src/index.ts` includes `export * from './probability/index.js'` | present | PASS — line 18 |
| Root `package.json` test command includes 3 new test files | present | PASS — all 3 in test command (line 17) |
| No new package.json or tsconfig.json needed | confirmed | PASS — no new package created |

### Test Gate

| Check | Required | Result |
|---|---|---|
| `pnpm test` | ≥120 (100 + ≥20 new) | **128/128** PASS (28 new tests) |
| `pnpm test:db` | 1/1 | 1/1 PASS |
| `pnpm lint` | clean | clean PASS |
| `pnpm type-check` | clean | clean PASS |
| `pnpm build` | clean | clean PASS |

---

## Code Audit Verification

| Check | Expected | Result |
|---|---|---|
| No imports from `unit-talk-production` paths | 0 imports | 0 — PASS |
| No Supabase or DB imports in probability directory | 0 references | 0 — PASS |
| No runtime service coupling (no Express, no HTTP) | 0 references | 0 — PASS |
| All functions are pure (no side effects, no I/O) | confirmed | PASS — no console, process.env, process.exit |
| Internal imports use `.js` extensions (ESM) | confirmed | PASS — all imports use `.js` |
| `probability-layer.ts` imports from `./devig.js` | confirmed | PASS — line 11 |
| `calibration.ts` imports `roundTo` from `./devig.js` | confirmed | PASS — line 1 |
| No rejected modules present (offerFetch, KellySizer, expectedValue) | 0 present | 0 — PASS |
| No changes to existing app runtime code | confirmed | PASS — `git diff HEAD -- apps/` = 0 lines |
| No old sprint reference comments (`INTELLIGENCE-*`, `SPRINT-024-*`) | 0 references | 0 — PASS |

---

## Deterministic Output Verification

At least one fixed-input test per module confirming known output:

| Module | Input | Expected Output | Result |
|---|---|---|---|
| devig | `americanToImplied(-110)` | `0.52381` (within tolerance) | PASS — `assert.equal(americanToImplied(-110), 0.52381)` |
| devig | `proportionalDevig(0.52381, 0.52381)` | fair probs summing to 1.0 | PASS — `overFair=0.5`, `overFair+underFair=1` |
| devig | `computeConsensus(2 books, proportional)` | deterministic consensus | PASS — order-independent, sharp weighted higher |
| probability-layer | `computePFinal(5.0, 0.55, 0.1, 0.8, 0.04)` | p_final = 0.55 (neutral) | PASS — `adjustmentRaw=0`, `pFinal=0.55` |
| calibration | `computeBrierScore([4 predictions])` | `0.065` | PASS — `(0.04+0.09+0.09+0.04)/4=0.065` |

---

## Verdict

- [x] All pre-implementation gates: PASS
- [x] All slice checks: PASS (12 devig + 10 probability-layer + 7 calibration + 4 integration)
- [x] All test gate checks: PASS (128/128 tests, lint/type-check/build clean)
- [x] Code audit clean (10/10 checks, 0 violations)
- [x] Deterministic output verified (5 fixed-input assertions confirmed)
- [x] No regression in prior tests (100 baseline tests unchanged)

**Verdict: PASS**

Independent verification performed 2026-03-21. All 14 close criteria from the contract are satisfied. No rollback trigger fired. No scope violation found. Math equivalence confirmed against old canonical source files.

**Week 15 is ready for formal closeout.**
