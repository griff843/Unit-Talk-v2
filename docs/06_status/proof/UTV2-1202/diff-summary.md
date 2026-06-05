# UTV2-1202 — Diff Summary

**Issue:** UTV2-1202 — Wave 1 — both-sides fair probability guard in candidate scoring
**Tier:** T2
**Branch:** codex/utv2-1202-both-sides-fair-probability-guard
**Executor:** codex-cli (executed by Claude orchestrator)

---

## Change Description

Single-character fix in `apps/api/src/candidate-scoring-service.ts` at line 210:

**Before:**
```typescript
if (universe.fair_over_prob === null && universe.fair_under_prob === null) { skipped++; continue; }
```

**After:**
```typescript
if (universe.fair_over_prob === null || universe.fair_under_prob === null) { skipped++; continue; }
```

The previous `&&` operator only skipped candidates when both sides were null. With one side null (e.g., `fair_over_prob=0.62`, `fair_under_prob=null`), the candidate would pass through to scoring, where a `?? 0` fallback silently substituted 0 for the missing probability. This produced incorrect scoring on incomplete market data.

The `||` guard now ensures any candidate lacking either fair probability is skipped — fail closed.

---

## Files Changed

| File | Change |
|---|---|
| `apps/api/src/candidate-scoring-service.ts` | `&&` → `||` on fair-prob null guard (line 210) |
| `apps/api/src/candidate-scoring-service.test.ts` | +2 tests for UTV2-1202 (one-sided null over, one-sided null under) |

**Files NOT changed (scope lock honored):**
- `apps/api/src/promotion-service.ts` (owned by UTV2-1200)
- No DB migrations
- No SGO activation
- No refactoring beyond the one condition fix

---

## Merge Order

UTV2-1202 is independent of UTV2-1200. No ordering dependency.
