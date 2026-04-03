# Board Cap Policy

**Status:** RATIFIED — `perSport` raised to 10 (2026-04-03, PM direction)
**Authority:** Runtime (`packages/contracts/src/promotion.ts`)  
**Updated:** 2026-04-03

---

## 1. Current Values (as of `best-bets-v1`)

| Cap | Value | Applies to |
|-----|-------|-----------|
| `perSport` | **10** | Max qualified picks on the best-bets board from the same sport |
| `perSlate` | 5 | Max total qualified picks on the best-bets board at any time |
| `perGame` | 1 | Max qualified picks on the best-bets board from the same game |

The same caps apply to `trader-insights-v1` and `exclusive-insights-v1`.

**Rationale:** `perSlate: 5` is the binding overall constraint. `perSport: 3` was unnecessarily restrictive for a single-capper NBA-focused system — it blocked the 4th qualifying NBA pick even when slate slots were available. At `perSport: 10`, the per-sport cap becomes non-binding in practice (perSlate:5 fires first), giving full slate flexibility without removing the overall board size guard.

These values are policy-in-code, not in the database. Changing them requires a code change + version bump in `packages/contracts/src/promotion.ts`.

---

## 2. What "Board Cap" Means at Runtime

Board caps are evaluated by `evaluateBestBetsPromotion()` in `@unit-talk/domain` during the promotion gate check. At promotion time, the service reads:

- `boardState.sameSportCount` — how many `qualified` picks on the board share the same sport as the new pick
- `boardState.currentBoardCount` — total qualified picks currently on the board
- `boardState.sameGameCount` — how many qualified picks share the same game event

If any count meets or exceeds its cap, the new pick is **not_eligible** (blocked by boardFit). It is NOT re-evaluated when older picks are settled — the cap check runs only at submission time.

---

## 3. How to Check Current Board Cap State at Runtime

Check via operator-web snapshot:
```
GET http://localhost:4200/api/operator/snapshot
```
The `boardUtilization` field shows `currentOpenPicks`, `capPerSlate`, and `utilizationPct`. For per-sport state, read `pick_promotion_history` where `promotion_target = 'best-bets' AND promotion_status = 'qualified'` grouped by sport.

---

## 4. Change History

| Date | Change | Authority |
|------|--------|-----------|
| 2026-04-02 | Initial policy documented: `perSport: 3` | Claude (runtime truth) |
| 2026-04-03 | Raised `perSport: 3 → 10` across all three targets | PM direction |
