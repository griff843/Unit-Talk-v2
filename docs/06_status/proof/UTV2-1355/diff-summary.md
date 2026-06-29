# UTV2-1355 Diff Summary — settlement listRecent since lower bound

## Scope

T2 code-only fix. Two production call sites patched. No DDL, no migrations, no new indexes.

**Files changed:**
- `apps/api/src/model-performance-service.ts` — line 175
- `apps/api/src/recap-service.ts` — line 154

**Files in scope but unchanged:**
- `packages/db/src/repositories.ts` — `listRecent(limit?, since?)` signature already supports `since`; no change needed

## Root Cause (per UTV2-1350)

`settlement_records.listRecent` with no `since` lower bound forces a full ORDER BY scan over 15,319+ rows, hitting statement timeout. With a `since` bound, queries complete in 136–152ms.

## Call Sites Fixed

### 1. `apps/api/src/model-performance-service.ts:175`

**Before:**
```ts
const recentSettlements = await repositories.settlements.listRecent(5000);
```

**After:**
```ts
// Enforce a 30-day lower bound to avoid full-table ORDER BY scan (UTV2-1355)
const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const recentSettlements = await repositories.settlements.listRecent(5000, since30d);
```

**Rationale:** Model performance metrics are computed over recent picks. A 30-day window covers all meaningful model scoring periods.

### 2. `apps/api/src/recap-service.ts:154`

**Before:**
```ts
const window = getRecapWindow(period, now);
const settlements = await repositories.settlements.listRecent(RECENT_SETTLEMENT_LIMIT);
```

**After:**
```ts
const window = getRecapWindow(period, now);
// Pass window.startsAt as the since lower bound to avoid full-table ORDER BY scan (UTV2-1355)
const settlements = await repositories.settlements.listRecent(RECENT_SETTLEMENT_LIMIT, window.startsAt);
```

**Rationale:** The recap function already computes a period window (daily ~1d, weekly ~7d, monthly ~30d) and filters settlements by it in application code. Passing `window.startsAt` as `since` eliminates the full-table scan without changing the result set.

## Out-of-scope finding: `settlements-query.ts`

`apps/api/src/routes/settlements-query.ts:23` also calls `listRecent(limit)` without `since`:
```ts
const settlements = await runtime.repositories.settlements.listRecent(limit);
```
This is a read endpoint for the Discord bot (`GET /api/settlements/recent?limit=50`, max 200). The limit cap (MAX_LIMIT=200) provides partial protection but still triggers a full ORDER BY scan. This file is outside the `file_scope_lock` for this lane and is documented here as a follow-up candidate.

## Tier Verdict

**T2** — call-site only changes, no DDL required.
