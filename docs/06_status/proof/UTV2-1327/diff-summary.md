# Diff Summary — UTV2-1327

**Issue:** Wire domainAnalysis at promotion time — DEBT-019 / DEBT-020
**Branch:** `claude/utv2-1327-model-driven-promotion-signals`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1088
**Merge SHA:** _(bound post-merge)_

---

## Files Changed

| File | Change |
|---|---|
| `apps/api/src/promotion-service.ts` | +31 lines: import, `enrichPickAtPromotionTime` helper, 2 call-site patches |
| `apps/api/src/promotion-edge-integration.test.ts` | +152 lines: 7 new tests for DEBT-019/020 fix |

---

## What Changed

### `promotion-service.ts`

**New import** (after clv-feedback import):
```typescript
import {
  computeSubmissionDomainAnalysis,
  enrichMetadataWithDomainAnalysis,
} from './domain-analysis-service.js';
```

**New exported helper** (`enrichPickAtPromotionTime`):
- Checks `pick.metadata['domainAnalysis']` — no-op if already present
- Calls `computeSubmissionDomainAnalysis(pick)` — no-op if null (no odds)
- Returns `{ ...pick, metadata: enrichMetadataWithDomainAnalysis(...) }` — in-memory copy only, no DB write
- Sets both `domainAnalysis.edge` and `domainAnalysis.kellyFraction`, fixing both debts in one enrichment

**Two call-site patches** in `evaluateAllPoliciesEagerAndPersist` and `persistPromotionDecisionForPick`:
```typescript
// Before:
const scoreInputs = await readPromotionScoreInputs(canonicalPick, ...);

// After:
const scoringPick = enrichPickAtPromotionTime(canonicalPick);
const scoreInputs = await readPromotionScoreInputs(scoringPick, ...);
```

### Why Both Debts Fixed Simultaneously

- `readDomainAnalysisEdgeScore(metadata)` reads `metadata.domainAnalysis.edge` → DEBT-019 resolved
- `readKellyGradientReadiness(metadata)` already had a fallback to `metadata.domainAnalysis.kellyFraction` (lines 1399-1404) — `enrichPickAtPromotionTime` provides the missing input → DEBT-020 resolved

---

## Impact

| Metric | Before | After |
|---|---|---|
| Picks with real edge signal at promotion | ~7.6% | 100% of picks with odds |
| Picks with real readiness signal at promotion | ~5.6% | 100% of picks with odds |
| Promotion score components that are model-driven | edge (35%) + readiness (20%) = 55% often using fallbacks | edge + readiness now computed from actual odds+confidence |

---

## Invariants Preserved

- No DB writes (in-memory enrichment only)
- Idempotent: existing `domainAnalysis` is never overwritten
- Fail-closed: if `odds` is null/missing, `computeSubmissionDomainAnalysis` returns null → enrichPickAtPromotionTime returns original pick unchanged
- UTV2-985 fail-closed market-backed edge logic is unaffected: `readMarketBackedEdgeScore` reads `realEdge`, not `edge` from domain analysis
