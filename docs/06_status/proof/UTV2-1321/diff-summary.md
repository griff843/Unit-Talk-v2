# Diff Summary — UTV2-1321 settlement.listRecent Partition-Pruning Fix

**Lane:** UTV2-1321  
**Tier:** T1 runtime  
**Branch:** claude/utv2-1321-settlement-listrecent-partition-pruning  
**Generated at:** 2026-06-26T15:50:00Z

---

## Root Cause

`DatabaseSettlementRepository.listRecent` had no lower-bound filter on `created_at`. Every call caused a full scan across all `settlement_records` partitions (daily partitions accumulating over months). Under load, this triggered `statement_timeout` in the CLV feedback computation path.

**Call stack:** `clv-feedback.ts:45 → computeClvTrustAdjustment → settlementRepository.listRecent(500)` — fetching 500 rows with no date filter, then immediately filtering in JS to the last 30 days.

Both call sites in `clv-feedback.ts` computed a `cutoffIso` (30 days ago) that was used only for JS-side filtering. The DB query itself was unbounded.

Same root cause class as the `markClosingLines` fix (same table family, same missing lower-bound pattern).

---

## Files Changed

### packages/db/src/repositories.ts

Added `since?: string | undefined` parameter to `SettlementRepository.listRecent` interface:

```diff
-  listRecent(limit?: number | undefined): Promise<SettlementRecord[]>;
+  listRecent(limit?: number | undefined, since?: string | undefined): Promise<SettlementRecord[]>;
```

### packages/db/src/runtime-repositories.ts

**InMemorySettlementRepository.listRecent:** added `since` filter before sort:

```diff
-  async listRecent(limit = 12): Promise<SettlementRecord[]> {
-    return [...this.settlements]
-      .sort(compareSettlementRecordsDescending)
-      .slice(0, limit);
+  async listRecent(limit = 12, since?: string): Promise<SettlementRecord[]> {
+    let results = [...this.settlements];
+    if (since !== undefined) {
+      results = results.filter((s) => s.created_at >= since);
+    }
+    return results
+      .sort(compareSettlementRecordsDescending)
+      .slice(0, limit);
   }
```

**DatabaseSettlementRepository.listRecent:** added `.gte('created_at', since)` partition-pruning filter:

```diff
-  async listRecent(limit = 12): Promise<SettlementRecord[]> {
-    const { data, error } = await this.client
-      .from('settlement_records')
-      .select()
-      .order('created_at', { ascending: false })
-      .limit(limit);
+  async listRecent(limit = 12, since?: string): Promise<SettlementRecord[]> {
+    let query = this.client
+      .from('settlement_records')
+      .select()
+      .order('created_at', { ascending: false })
+      .limit(limit);
+
+    if (since !== undefined) {
+      query = query.gte('created_at', since);
+    }
+
+    const { data, error } = await query;
```

### apps/api/src/clv-feedback.ts

Both `listRecent(500)` calls now pass `cutoffIso` as the `since` lower-bound (already computed at both call sites):

```diff
-  const recentSettlements = await settlementRepository.listRecent(500);
+  const recentSettlements = await settlementRepository.listRecent(500, cutoffIso);
```

(Applied at line 45 in `computeClvTrustAdjustment` and line 127 in `computeAndPersistMarketFamilyClvFeedback`.)

---

## Before / After Timing

| Metric | Before fix | After fix |
|---|---|---|
| `pnpm test:db` result | 4/7 pass (tests 1,3,4,6 fail) | 7/7 pass |
| `pnpm test:db` total duration | ~207s | ~127s |
| Tests 4 + 6 (settlement path) | TIMEOUT | 20s + 19s each |
| Root error | `settlement.listRecent` statement_timeout | eliminated |

The 30s reduction in total run time reflects the elimination of the full partition scan on each submission that triggers CLV feedback computation.

---

## Secondary Finding (out of scope for this lane)

A second timeout class was observed: `settle_pick_atomic` (Postgres RPC at `runtime-repositories.ts:4324`) timing out during high-DB-load conditions. This is a different procedure from `listRecent` and is out of scope for this lane. Flag for follow-up.

---

## Scope

- 3 source files changed (interface + 2 implementations + 2 call sites)
- No schema migration
- No DB mutation
- No data backfill
- No broad refactor

R-level check: PASS

---

## Merge SHA Binding

**Merge SHA:** `(to be bound post-merge)`  
**PR:** (to be opened)  
**Merged at:** (pending)
