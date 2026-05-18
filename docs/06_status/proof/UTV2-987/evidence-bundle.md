# Evidence Bundle — UTV2-987: Uniqueness Real Signal

**Schema:** evidence-bundle/v1  
**Issue:** UTV2-987  
**Branch:** claude/utv2-987-uniqueness-real-signal  
**Merge SHA:** (populated at merge)  
**Generated:** 2026-05-17T00:00:00.000Z

---

## Problem Statement

The uniqueness scorer in `computeUniquenessScore` had no way to distinguish between
"no open picks data available" (fallback to 50) and "genuine zero saturation" (score 100).
Both returned a raw number with no explanation. Operators could not audit whether a high
uniqueness score was a real signal or a silent fallback.

Additionally, the selection overlap dimension (same player/participant targeted by multiple
open picks) was not used in uniqueness scoring, leaving a concentration risk blind spot.

---

## Changes Made

### `packages/domain/src/scoring/uniqueness.ts`

- Added `activeSelectionOverlapCount` to `UniquenessInput`
- Added `UniquenessResult` interface: `{ score, fallbackReason?, dimensions }`
- Added `computeUniquenessWithMeta()` — returns full result with labeled fallback reason and dimensions
- Kept `computeUniquenessScore()` as backward-compat wrapper (calls `computeUniquenessWithMeta` internally)
- Fallback path: when `activeSameSportMarketCount === undefined` → `score: 50, fallbackReason: 'no-open-picks-data', dimensions: null`
- Real signal path: dimensions include `{ sameSportMarketCount, selectionOverlapCount }`

### `packages/domain/src/scoring/uniqueness.test.ts`

- Kept all 7 original `computeUniquenessScore` backward-compat tests (all pass)
- Added 5 new tests for `computeUniquenessWithMeta` (fallback reason, dimensions, overlap penalty, cap)

### `apps/api/src/promotion-service.ts`

- Updated `readPromotionScoreInputs` to:
  - Compute `activeSelectionOverlapCount` (first 2 tokens of selection string)
  - Call `computeUniquenessWithMeta` instead of `computeUniquenessScore`
  - Return `uniquenessFallbackReason` and `uniquenessInputs` in scoreInputs
- Updated both `makeSnapshot` locations (`persistPromotionDecisionForPick` and multi-policy evaluator) to spread uniqueness metadata into `PromotionDecisionSnapshot.scoreInputs`

### `packages/contracts/src/promotion.ts`

- Added `uniquenessFallbackReason?: string | undefined` to `PromotionDecisionSnapshot.scoreInputs`
- Added `uniquenessInputs?: { sameSportMarketCount, selectionOverlapCount } | undefined` to `PromotionDecisionSnapshot.scoreInputs`

### `apps/api/src/promotion-edge-integration.test.ts`

- Replaced 2 placeholder tests with correct assertions:
  - `snapshot includes uniquenessInputs with zero saturation when no same-market peers open`
  - `snapshot includes uniquenessInputs with saturation count when same-market peers are open`
- All 66 tests pass

---

## Assertions

| # | Assertion | Expected | Actual |
|---|-----------|----------|--------|
| 1 | `computeUniquenessWithMeta({ activeSameSportMarketCount: undefined })` | `score: 50, fallbackReason: 'no-open-picks-data'` | PASS |
| 2 | `computeUniquenessWithMeta({ activeSameSportMarketCount: 0 })` | `score: 100, dimensions: { sameSportMarketCount: 0, selectionOverlapCount: 0 }` | PASS |
| 3 | `computeUniquenessScore()` (backward-compat wrapper) | Returns number (unchanged public API) | PASS (7 tests) |
| 4 | `snapshot.scoreInputs.uniquenessInputs` present after promotion | Defined with `sameSportMarketCount` and `selectionOverlapCount` | PASS |
| 5 | `snapshot.scoreInputs.uniquenessFallbackReason` absent when openPicks is array | `undefined` | PASS |
| 6 | `uniquenessInputs.sameSportMarketCount >= 1` when same-market peer open | `>= 1` | PASS |
| 7 | Selection overlap penalty reduces score by 15 per overlapping pick | `score: 85` for 1 overlap, `score: 70` for 2 | PASS |

---

## Test Results

- `uniqueness.test.ts`: **12/12 pass**
- `promotion-edge-integration.test.ts`: **66/66 pass**
- `pnpm verify`: **PASS** (lint + type-check + build + all tests)
- R-level: **PASS** (no artifacts required)
- `pnpm test:db`: **7/7 pass** (live Supabase)

---

## Before / After: Snapshot scoreInputs

**Before UTV2-987:**
```json
{
  "edge": 0,
  "trust": 65,
  "readiness": 60,
  "uniqueness": 50,
  "boardFit": 75
}
```

**After UTV2-987 (no peers):**
```json
{
  "edge": 0,
  "trust": 65,
  "readiness": 60,
  "uniqueness": 100,
  "boardFit": 75,
  "uniquenessInputs": {
    "sameSportMarketCount": 0,
    "selectionOverlapCount": 0
  }
}
```

**After UTV2-987 (2 same-market peers):**
```json
{
  "edge": 0,
  "trust": 65,
  "readiness": 60,
  "uniqueness": 80,
  "boardFit": 75,
  "uniquenessInputs": {
    "sameSportMarketCount": 2,
    "selectionOverlapCount": 0
  }
}
```

The uniqueness score is now a real signal — operators can see exactly what drove it.
