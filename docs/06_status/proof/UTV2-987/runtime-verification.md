# Runtime Verification — UTV2-987

**Issue:** UTV2-987 — Uniqueness Real Signal  
**Branch:** claude/utv2-987-uniqueness-real-signal  
**Verified by:** claude  
**Verification date:** 2026-05-17

---

## Pre-Merge Checklist

- [x] `pnpm verify` green (lint + type-check + build + all unit tests)
- [x] R-level check PASS — no additional artifacts required
- [x] `pnpm test:db` green — 7/7 live-DB tests pass
- [x] `promotion-edge-integration.test.ts` — 66/66 pass (includes 2 new UTV2-987 tests)
- [x] `uniqueness.test.ts` — 12/12 pass (7 backward-compat + 5 new)
- [x] T1 proof test created: `apps/api/src/t1-proof-utv2-987-uniqueness-signal.test.ts`
- [x] `PromotionDecisionSnapshot.scoreInputs` type extended in `packages/contracts/src/promotion.ts`
- [x] Both `makeSnapshot` locations updated to include uniqueness metadata
- [x] Backward-compat: `computeUniquenessScore()` still exported and returns `number`

---

## Behavioral Change

**Before:** `computeUniquenessScore()` returned a silent `50` when no open-picks data was available. Operators had no way to distinguish genuine uniqueness (score 100 = no competitors) from a data-absent fallback (score 50 = unknown).

**After:** `computeUniquenessWithMeta()` labels the fallback explicitly:
- `fallbackReason: 'no-open-picks-data'` when `activeSameSportMarketCount === undefined`
- `dimensions: { sameSportMarketCount, selectionOverlapCount }` when real data is available
- `PromotionDecisionSnapshot.scoreInputs.uniquenessInputs` captures these dimensions for every promotion decision

**Selection overlap dimension:** First 2 tokens of `pick.selection` are used as a participant identifier. Open picks with the same prefix incur a 15-point penalty per overlap (capped at 30).

---

## Live-DB Proof Output (pnpm test:db)

```
✔ database repository bundle persists a submission and settlement when Supabase is configured (41594ms)
✔ UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row (40151ms)
✔ UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes (43970ms)
✔ UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row (40528ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (639ms)
✔ UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows (43872ms)
✔ UTV2-996: correction chain is additive — original settlement row is not mutated (42044ms)
tests 7 | pass 7 | fail 0
```

---

## Invariant Audit

- `computeUniquenessScore()` backward-compat: **preserved** — wrapper delegates to `computeUniquenessWithMeta().score`
- Domain purity: **preserved** — no I/O, no DB, no HTTP in `uniqueness.ts`
- Fail-closed: **preserved** — fallback score is 50 (neutral), not inflated
- Snapshot determinism: **preserved** — same inputs produce same `uniquenessInputs` dimensions
- Type safety: **enforced** — `PromotionDecisionSnapshot.scoreInputs` updated in `@unit-talk/contracts`
