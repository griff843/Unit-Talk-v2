# Board Cap Policy

**Status:** DOCUMENTED — PM DECISION PENDING  
**Authority:** Runtime (`packages/contracts/src/promotion.ts`)  
**Updated:** 2026-04-03

---

## 1. Current Values (as of `best-bets-v1`)

| Cap | Value | Applies to |
|-----|-------|-----------|
| `perSport` | **3** | Max qualified picks on the best-bets board from the same sport |
| `perSlate` | 5 | Max total qualified picks on the best-bets board at any time |
| `perGame` | 1 | Max qualified picks on the best-bets board from the same game |

The same caps apply to `trader-insights-v1` and `exclusive-insights-v1`.

These values are policy-in-code, not in the database. Changing them requires a code change + version bump in `packages/contracts/src/promotion.ts`.

---

## 2. What "Board Cap" Means at Runtime

Board caps are evaluated by `evaluateBestBetsPromotion()` in `@unit-talk/domain` during the promotion gate check. At promotion time, the service reads:

- `boardState.sameSportCount` — how many `qualified` picks on the board share the same sport as the new pick
- `boardState.currentBoardCount` — total qualified picks currently on the board
- `boardState.sameGameCount` — how many qualified picks share the same game event

If any count meets or exceeds its cap, the new pick is **not_eligible** (blocked by boardFit). It is NOT re-evaluated when older picks are settled — the cap check runs only at submission time.

---

## 3. Operational Impact for Single-Capper NBA Focus

**Current behavior:** The 4th NBA pick submitted in the same day/session will be blocked by `perSport: 3` regardless of how good the pick is.

**Why this matters:**
- In a single-capper system, all submissions come from one person
- NBA is the primary sport during the current burn-in period
- `perSport: 3` is hit as soon as 3 NBA picks have qualified
- The 2026-04-02 DB reset cleared all prior qualified picks — cap is currently at 0
- The saturation condition will recur after 3 new qualifying NBA submissions

**What the pick owner sees:** The pick is stored and visible in the operator dashboard, but `pick_promotion_history.promotion_status = 'not_eligible'` and no outbox row is created.

---

## 4. PM Decision Required

One of these actions is needed before the cap condition recurs:

### Option A — Keep perSport: 3 (no code change)
**If intentional:** Document this as the intended cap for the burn-in phase. Operator accepts that only 3 NBA picks per day will reach best-bets. Tracking the cap state via the operator dashboard is the workflow.

### Option B — Raise perSport (code change, PM approval required)
Suggested: `perSport: 10` (supports full NBA slate coverage without practical daily blocking).

Change required:
```typescript
// packages/contracts/src/promotion.ts
export const bestBetsPromotionPolicy: PromotionPolicy = {
  // ...
  boardCaps: {
    perSlate: 5,    // keep or also raise
    perSport: 10,   // was 3
    perGame: 1,     // keep
  },
  version: 'best-bets-v2',  // bump version
};
```

Also bump `traderInsightsPromotionPolicy` and `exclusiveInsightsPromotionPolicy` if cap is also intended for those lanes.

**After change:** `pnpm test` must remain green. No migration needed — board cap is a runtime policy, not stored in DB schema.

---

## 5. How to Check Current Board Cap State at Runtime

```bash
# Query how many qualified best-bets picks exist per sport right now
# Run against live Supabase
```

Or check via operator-web snapshot:
```
GET http://localhost:4200/api/operator/snapshot
```
The `recentPicks` array shows pick statuses, but does not directly report board cap state. For board cap state, read `pick_promotion_history` where `promotion_target = 'best-bets' AND promotion_status = 'qualified'` grouped by sport.

---

## 6. This Contract Does Not Change Policy

This document records current runtime truth. It does not authorize changing `perSport`. A PM comment or commit directive is required before Option B is executed.
