# Promotion Score Accuracy Audit

**Date:** 2026-05-11  
**Issue:** UTV2-889  
**Auditor:** Claude (orchestrator)  
**Data range:** 2026-04-21 – 2026-05-08 (30 days)  
**Sample size:** 12,043 rows with `scoreInputs` present in `pick_promotion_history`  

---

## Summary Verdict

**3 of 5 promotion score inputs are systematically broken or missing.** Only `trust` shows partial real signal. `edge` has signal for 7.4% of picks. The system is making promotion decisions on a degraded score for the vast majority of picks.

| Input | Weight | Status | Confidence |
|---|---|---|---|
| edge | 35% | **DEGRADED** — 92.4% confidence-fallback, 0.2% real market edge | Low |
| trust | 25% | **PARTIAL** — real signal for some picks, falls back to confidence for many | Medium |
| readiness | 20% | **DEGRADED** — 94.4% fallback to 60 (Kelly data missing) | Low |
| uniqueness | 10% | **BROKEN** — hardcoded at 50 for 99.9% of picks | None |
| boardFit | 10% | **BROKEN** — 74.9% score exactly 10 (floor value, not fallback) | None |

---

## Input-by-Input Analysis

### 1. Edge (weight: 35%)

**What it should compute:** Real market edge — pick odds vs devigged closing/current line from SGO or multi-book consensus.

**What it actually computes:**

| Edge Source | Quality | Count | % |
|---|---|---|---|
| confidence-delta | confidence-fallback | 9,949 | 82.6% |
| confidence-delta | null | 1,182 | 9.8% |
| explicit | explicit | 888 | 7.4% |
| sgo-edge | market-backed | 24 | 0.2% |

**92.4% of picks use `confidence-delta` as the edge source** — the capper's self-reported confidence converted to a score, not a comparison against the market. Only **24 picks out of 12,043** (0.2%) used real SGO market-backed edge data.

**Score distribution:** avg=41.13, min=0, max=100. Variance exists, but it reflects confidence spread, not edge.

**Gap:** `readDomainAnalysisEdgeScore()` returns null for 92% of picks because `domainAnalysis` metadata is not populated. The ingestor runs the market data pipeline but the domain analysis is not being written back to pick metadata for the vast majority of picks.

**Verdict:** DEGRADED. The highest-weighted input (35%) is a confidence proxy 92% of the time.

---

### 2. Trust (weight: 25%)

**What it should compute:** Model trust signal — how much the system trusts the domain analysis backing this pick. Adjusted upward by positive CLV history (via `computeClvTrustAdjustment()`).

**What it actually computes:** `readDomainAnalysisTrustSignal()` reads `metadata.domainAnalysis`. Falls back to `confidenceScore` when absent.

**Score distribution:** avg=60.64, min=50.00, max=98.00. The floor at 50 is the confidence fallback.

**Assessment:** Trust shows genuine variance (50–98) and the signal is reaching some picks. The CLV feedback adjustment is wired and running (confirmed in code: `computeClvTrustAdjustment()` is called when repositories are available). However the same `domainAnalysis` metadata gap that affects edge also affects trust — the 50 floor indicates a significant portion are falling back.

**Verdict:** PARTIAL. Signal is working but coverage is incomplete.

---

### 3. Readiness (weight: 20%)

**What it should compute:** Pick readiness signal via Kelly gradient — how much the sizing model is recommending. Higher Kelly = higher readiness.

**What it actually computes:**

| Readiness Value | Count | % |
|---|---|---|
| 60 (fallback) | 11,367 | 94.4% |
| 51 | 459 | 3.8% |
| 40–49 range | ~125 | 1.0% |
| 80+ | ~21 | 0.2% |

**94.4% of picks fall back to exactly 60** — `readKellyGradientReadiness()` returns null because `pick.metadata.kellySizing` is not populated for almost all picks.

The Kelly sizing infrastructure exists (`computeKellySize()` in `packages/domain/src/risk/`), but the results are not being written back into `pick.metadata.kellySizing` before promotion evaluation runs. This is a wiring gap between the Kelly computation and the pick metadata.

**Verdict:** DEGRADED. 94.4% of picks receive a neutral-fallback readiness score. The input is a constant, not a signal.

**New issue required:** Track the wiring gap — Kelly sizing is computed but not written to `pick.metadata` before promotion.

---

### 4. Uniqueness (weight: 10%)

**What it should compute:** Market differentiation — how unique this pick is vs the current board and public lines.

**What it actually computes:** `readScore(configured, 'uniqueness', 50)` — hardcoded neutral default 50. Confirmed in `apps/api/src/promotion-service.ts` line 1019.

**Score distribution:** avg=50.02, min=50.00, max=60.00, stddev=0.42. The tiny variance (max=60) is from explicit `promotionScores.uniqueness` overrides on a small number of picks, not a computed signal.

**Verdict:** BROKEN. No signal. Tracked as UTV2-879 (blocked on this audit completing).

---

### 5. BoardFit (weight: 10%)

**What it should compute:** Portfolio fit — concentration and correlation penalty based on the current board of open picks.

**What it actually computes:**

| BoardFit Value | Count | % |
|---|---|---|
| **10** | **9,033** | **74.9%** |
| 100 | 1,300 | 10.8% |
| 82 | 651 | 5.4% |
| 64 | 411 | 3.4% |
| 29 | 357 | 3.0% |
| 75 (fallback) | 84 | 0.7% |

**74.9% of picks score exactly 10.** This is NOT the no-board-data fallback (which is 75). The value 10 is the output of `computeBoardFitScore()` — meaning the function is being called and returning 10 for most picks.

This indicates `computeBoardFitScore()` is treating most picks as maximally board-unfitting — the concentration or correlation penalty is hitting a floor. Possible causes:
- The board state passed to the function always contains many open picks for the same sport/market, triggering max concentration penalty
- The board correlation penalty is not filtering self (already in code, but may have a bug)
- The board state snapshot is being computed incorrectly (stale or duplicated picks included)

Only 84 rows (0.7%) hit the actual fallback value of 75, meaning the board is almost always populated and being computed — just returning a floor value.

**Verdict:** BROKEN. The function is running but producing a floor value for 75% of picks. This requires a dedicated investigation issue.

---

## Structural Gaps (Separate from Input Accuracy)

### Breakdown never stored

`payload->'breakdown'` is **null for all 18,866 rows** in the dataset. The breakdown (per-component weighted score: edge×0.35, trust×0.25, readiness×0.20, uniqueness×0.10, boardFit×0.10 = total) is never persisted. This makes it impossible to audit how each component contributed to the final promotion score for any historical pick.

This is an extension of DEBT-008 (promotion scores in JSON payload, not top-level columns). Tracked under UTV2-541.

### Qualification result not visible

The payload keys in the last 7 days (`policy`, `gateInputs`, `policyVersion`, `boardStateAtDecision`, `weightsUsed`, `explanation`, `scoringProfile`, `scoreInputs`, `narrative`) do not include a top-level `qualified` or `score` field. The qualification decision is nested inside `explanation` or `scoringProfile`. Without a top-level qualified field it is not possible to run a straightforward qualification rate query.

---

## Score Spot-Check (10 qualified picks)

The `payload->>'qualified'` and `payload->>'score'` keys do not appear at the payload top-level in the current schema. The explanation and scoringProfile objects need to be queried to retrieve qualification decisions. **This means the standard `ops:truth-check` promotion queries may not be able to reliably count promoted picks.** Issue UTV2-541 (DEBT-008) should explicitly track the top-level column gap as blocking auditability.

---

## Conclusion

The promotion scoring system is operating in a significantly degraded state:

- **Only trust** has meaningful partial signal
- **Edge** is a confidence proxy 92% of the time (not real market edge)
- **Readiness** is a constant fallback 94% of the time (Kelly sizing not wired to pick metadata)
- **Uniqueness** is hardcoded at 50 (tracked UTV2-879)
- **BoardFit** is returning a floor value of 10 for 75% of picks (new finding — needs root cause)

The weighted promotion score being produced is approximately:
`score ≈ 0.35×(confidence) + 0.25×(partial_trust) + 0.20×(60) + 0.10×(50) + 0.10×(10)`

For a typical pick with no domain analysis: `0.35×50 + 0.25×50 + 0.20×60 + 0.10×50 + 0.10×10 = 17.5 + 12.5 + 12 + 5 + 1 = 48`. The system is scoring most picks around 48/100 by default.

---

## New Issues Required

| Finding | Priority | Action |
|---|---|---|
| Kelly sizing not written to `pick.metadata` before promotion | High | New T2 issue: wire Kelly result to pick metadata |
| `computeBoardFitScore()` returning 10 for 75% of picks | High | New T2 issue: investigate boardFit floor value |
| Breakdown never stored in `pick_promotion_history` | Medium | Update DEBT-008 / UTV2-541 to flag auditability gap |
| 92% of edge scores are confidence-delta fallback | High | Root cause: `domainAnalysis` metadata not being written |

---

## Next Steps

1. UTV2-879 (uniqueness signal) — unblocked by this audit. Can proceed.
2. New issue: Kelly sizing wiring gap (readiness input)
3. New issue: BoardFit floor value root cause
4. New issue: `domainAnalysis` metadata gap (affects both edge and trust)
5. DEBT-008 / UTV2-541: update to include breakdown storage gap
