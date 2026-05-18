# Evidence Bundle — UTV2-988

**Issue:** [UTV2-980H] Persist promotion band assignment for model performance proof  
**Tier:** T1  
**Merge SHA:** (set at merge)  
**Generated:** 2026-05-18

---

## Problem

`resolvePromotionBand` in `apps/api/src/promotion-service.ts` had two non-deterministic fallbacks:

1. `existingBand`: read `picks.metadata.band` from the current pick — if a prior promotion already set a band (possibly with different scoring inputs), the stale value was returned without recomputation.
2. `modelTier`: read `picks.metadata.modelTier` or `picks.metadata.model_tier` — an arbitrary legacy field that could be any string.

This meant: after scoring fixes (UTV2-985/986/987), re-promoted picks would keep stale bands from prior runs, masking the improved inputs. Band-sliced CLV/ROI/calibration proof was impossible.

**Audit count:** 1,000+ picks with `promotion_status IS NOT NULL` AND `metadata->>'band' IS NULL` (historical gap from pre-determinism era; oldest: 2026-04-21).

---

## Changes

### `apps/api/src/promotion-service.ts`

- Renamed `resolvePromotionBand` → `computeDeterministicBand`
- Removed `existingBand` early return (stale read from `pick.metadata.band`)
- Removed `modelTier` fallback (legacy metadata read)
- Added explicit return type `: string`
- Added fail-closed guard: throws if `applyBandDowngrades` returns empty (defensive; cannot fire in practice since `BandTier` is always a non-empty string)
- Updated all 5 call sites

**New function contract:**
- Input: `(pick, scoreInputs, decision)`
- Output: always a non-null `BandTier` string
- `decision.qualified = false` → `'SUPPRESS'`
- `decision.qualified = true` → computed from `buildBandInput` → `initialBandAssignment` → `applyBandDowngrades`
- No reads from `pick.metadata.band` or `pick.metadata.modelTier`

### `apps/api/src/t1-proof-utv2-988-band-persistence.test.ts` (new)

5 tests: 2 live-DB + 3 unit.

---

## Assertions Table

| # | Type | Assertion | Result |
|---|------|-----------|--------|
| 1 | Live-DB | 1,000+ null-band picks classified as historical gap (pre-determinism era; oldest 2026-04-21) | PASS |
| 2 | Live-DB | After `evaluateAllPoliciesEagerAndPersist`, `picks.metadata.band` is non-null string; all 3 `pick_promotion_history.payload.band` rows set | PASS |
| 3 | Unit | Two consecutive promotion runs on same pick produce identical band (determinism) | PASS |
| 4 | Unit | Non-qualified pick (low scores) → `metadata.band = 'SUPPRESS'` | PASS |
| 5 | Unit | Pick with stale `metadata.band = 'SUPPRESS'` + high-quality inputs → computed band ≠ SUPPRESS (no-stale-reads) | PASS — result `C` |

---

## Live-DB Proof Output

```
[T1-PROOF] null-band picks with promotion_status: 1000 (historical gap — pre-determinism era)
[T1-PROOF] oldest null-band pick created_at: 2026-04-21T00:29:26.78+00:00
✔ LIVE-DB: classify null-band picks as historical gap (302ms)
[T1-PROOF] picks.metadata.band = SUPPRESS
[T1-PROOF] history[trader-insights].payload.band = SUPPRESS
[T1-PROOF] history[exclusive-insights].payload.band = SUPPRESS
[T1-PROOF] history[best-bets].payload.band = SUPPRESS
[T1-PROOF] band persistence verified: picks.metadata.band and history.payload.band both set
✔ LIVE-DB: newly promoted pick has band in metadata and matching band in history payload (2813ms)
[PROOF] stale SUPPRESS overridden — computed band: C
✔ computeDeterministicBand is deterministic (17ms)
✔ computeDeterministicBand: non-qualified pick gets SUPPRESS band persisted (1ms)
✔ computeDeterministicBand: pre-set metadata.band=SUPPRESS is overridden for qualified pick (2ms)
ℹ tests 5 | pass 5 | fail 0
```

---

## Historical Gap Classification

**Decision (per PM UTV2-988 approval):** The 1,000+ null-band rows are classified as **historical gap — pre-determinism era**. These picks were promoted before `computeDeterministicBand` was deployed.

**No backfill applied.** Historical null-band rows are excluded from band-sliced analytics until a separate PM-approved backfill lane is executed.

---

## PM Constraints Satisfied

| Constraint | Status |
|-----------|--------|
| Band assignment deterministic (same inputs → same output) | ✓ Stale reads removed; function is purely `(scoreInputs, decision) → BandTier` |
| Historical ambiguity explicit | ✓ 1,000+ rows classified as historical gap, no silent reconstruction |
| Promotion history as canonical proof surface | ✓ `payload.band` written for all 3 policy rows in every promotion run |
| Fail closed on missing band | ✓ Guard throws if `finalBand` is empty (cannot fire in practice) |
