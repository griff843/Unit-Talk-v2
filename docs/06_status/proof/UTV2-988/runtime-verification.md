# Runtime Verification — UTV2-988

**Issue:** Persist promotion band assignment for model performance proof  
**Tier:** T1  
**Verified:** 2026-05-18

---

## Pre-Merge Checklist

- [x] `pnpm verify` green on branch
- [x] R-level check PASS
- [x] T1 proof tests: 5/5 pass
- [x] Live-DB proof: band written to `picks.metadata` and `pick_promotion_history.payload`
- [x] Historical null-band rows explicitly classified (not silently reconstructed)

---

## Behavioral Change

**Before:** `resolvePromotionBand` read `pick.metadata.band` first — returning any stale value from a prior promotion run. A pick re-promoted after scoring fixes (UTV2-985/986/987) would keep its old band unchanged.

**After:** `computeDeterministicBand` ignores `pick.metadata.band` entirely. Band is always computed fresh from `(scoreInputs, decision)`. Same inputs always produce the same band.

---

## Live-DB Evidence

### Null-band audit
- **1,000+ picks** with `promotion_status IS NOT NULL` AND `metadata->>'band' IS NULL`
- Oldest: `2026-04-21T00:29:26.78+00:00`
- Classification: **historical gap — pre-determinism era**
- Disposition: excluded from band analytics until separate PM-approved backfill

### Persistence verification
- Test pick created on live Supabase
- `evaluateAllPoliciesEagerAndPersist` ran successfully
- `picks.metadata.band` = `SUPPRESS` (non-null ✓)
- `pick_promotion_history.payload.band` = `SUPPRESS` for all 3 policy rows ✓
- Test data cleaned up (picks, submissions, pick_promotion_history rows deleted)

---

## Invariant Audit

| Invariant | Check |
|-----------|-------|
| Domain package pure (no I/O) | No changes to packages/domain |
| No new DB migrations | Not required — band persistence uses existing metadata JSONB column |
| Fail-closed on missing band | Guard added; cannot fire in practice but enforced defensively |
| Band written to both surfaces | `metadataPatch: { band }` + `payload.band` — unchanged from before; now guaranteed non-stale |
| Promotion history = canonical proof surface | `pick_promotion_history.payload.band` set for all 3 policy rows per promotion run |
