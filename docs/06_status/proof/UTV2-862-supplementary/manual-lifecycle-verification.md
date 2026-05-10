# UTV2-862 Manual Lifecycle Verification

**Date:** 2026-05-09  
**Executor:** Claude (orchestrator)  
**Branch:** main (post-merge SHA 592bd869)  
**Goal:** Controlled manual verification of the corrected provider-history retention lifecycle before the 10pm scheduled cron window.

---

## Sequence Executed

| # | Function | Status | Notes |
|---|---|---|---|
| 1 | `summarize_provider_offer_history_partition('2026-04-29')` | **FAILED** | PL/pgSQL `snapshot_date` ambiguity bug in function body |
| 2 | `drop_old_provider_offer_history_partitions(7)` | **PASSED** | 3 partitions dropped, cutoff 2026-05-02 |
| 3 | `prune_provider_offers_bounded(7, 5000, 20)` | **FAILED** | Statement timeout (2 min); DELETE via view over 8.2M quarantine rows, no `created_at` index |

---

## Baseline (pre-execution)

| Metric | Value |
|---|---|
| Today | 2026-05-09 |
| Retention cutoff (7 days) | 2026-05-02 |
| Partitions eligible for drop | p20260429, p20260430, p20260501 |
| Rows in eligible partitions | 0 (all empty) |
| `provider_offer_history` parent rows | 0 |
| `provider_offer_current` rows | 167,498 |
| `provider_offer_staging` rows | 22,824 |
| `provider_offers_legacy_quarantine` rows | 8,291,206 |

---

## Step 1 — summarize_provider_offer_history_partition('2026-04-29')

**Result: FAILED**

```
ERROR: 42702: column reference "snapshot_date" is ambiguous
DETAIL: It could refer to either a PL/pgSQL variable or a table column.
CONTEXT: PL/pgSQL function summarize_provider_offer_history_partition(date) line 30 at SQL statement
```

**Root cause:** The function returns `TABLE(rows_summarized integer, snapshot_date date)`. Inside the function body, the CTE `agg` aliases the column `p_date AS snapshot_date`. When the outer INSERT SELECT from `agg` references `snapshot_date`, PL/pgSQL cannot resolve whether it refers to the CTE column or the OUT parameter.

**Fix required:** Rename the CTE alias from `snapshot_date` to an unambiguous name (e.g., `snap_dt`) throughout the function body.

**Migration status check:** Migration `20260509160906` (`202605090001_utv2_862_cron_fix_partition_lifecycle`) is applied in production but only fixed the cron schedule body — it did not replace the function definition. The function bug predates and survives the UTV2-862 migration.

---

## Step 2 — drop_old_provider_offer_history_partitions(7)

**Result: PASSED**

```json
{ "partitions_dropped": 3, "cutoff_date": "2026-05-02" }
```

Partitions dropped: `p20260429`, `p20260430`, `p20260501`  
All three had 0 rows at time of drop — no data loss.

Post-drop partition list verified: p20260502 through p20260514 remain intact.

---

## Step 3 — prune_provider_offers_bounded(7, 5000, 20)

**Result: FAILED**

```
ERROR: 57014: canceling statement due to statement timeout
CONTEXT: SQL statement "WITH doomed AS (
  SELECT id FROM public.provider_offers
  WHERE created_at < v_cutoff
  ORDER BY created_at ASC, id ASC
  LIMIT p_batch_size
)
DELETE FROM public.provider_offers WHERE id IN (SELECT id FROM doomed)"
PL/pgSQL function prune_provider_offers_bounded(integer,integer,integer) line 26 at SQL statement
```

**Root causes:**

1. **`provider_offers` is a view** — `public.provider_offers` is a compatibility view over `provider_offers_legacy_quarantine` (8,291,206 rows). The rename happened after the 2026-04-07 storage incident; the view was created to preserve backward compatibility. The prune function was not updated to target the renamed table.

2. **No `created_at` index on the quarantine table** — The function's DELETE query uses `WHERE created_at < v_cutoff ORDER BY created_at ASC, id ASC`. The quarantine table has no index on `created_at` (only `snapshot_at` indexes). The SELECT subquery performs a full sequential scan on 8.2M rows, exceeding the 2-minute statement timeout before the first 5,000-row batch can execute.

**Available indexes on `provider_offers_legacy_quarantine`:**
- `provider_offers_pkey` — btree(id)
- `provider_offers_idempotency_key_idx` — btree(idempotency_key)
- `provider_offers_snapshot_at_idx` — btree(snapshot_at DESC)
- `idx_provider_offers_snapshot_brin` — brin(snapshot_at)
- Various compound indexes — all on `snapshot_at`, not `created_at`

**Fix required:** Add `CREATE INDEX ... ON provider_offers_legacy_quarantine (created_at ASC, id ASC)` and update the function to DELETE directly from `provider_offers_legacy_quarantine` rather than the view.

---

## Verification Checklist

| Check | Result |
|---|---|
| summarize executes successfully | ❌ FAILED — function body bug |
| drop executes successfully | ✅ PASSED |
| prune executes successfully | ❌ FAILED — timeout |
| summarize occurs before drop | ❌ NOT MET — summarize failed |
| no unexpected partition loss | ✅ PASSED — only empty eligible partitions dropped |
| no unexpected row loss | ✅ PASSED — all dropped partitions were empty |
| no SQL errors | ❌ FAILED — 2 errors |
| no retention corruption | ✅ PASSED — drop logic was correct |

---

## New Defects Identified

### Bug A — `summarize_provider_offer_history_partition`: snapshot_date ambiguity
- **Severity:** Blocking — cron will fail silently at 3am every night (the cron body uses `SELECT *` which discards errors in most pg_cron configurations)
- **Scope:** Function body DDL fix only; no data migration needed
- **Fix:** Rename CTE column alias `snapshot_date` → `snap_dt` (or equivalent) inside the function

### Bug B — `prune_provider_offers_bounded`: targets view over 8.2M rows, no created_at index
- **Severity:** Blocking — 7-day retention on `provider_offers_legacy_quarantine` is not executing; table will grow unbounded
- **Scope:** Two-part fix: (1) add `created_at` index to quarantine table; (2) update function to DELETE from `provider_offers_legacy_quarantine` directly
- **Note:** The view approach also means `RETURNING` or row counts may behave unexpectedly depending on view rules

---

## Gate Recommendation

**Do NOT clear the `merge_provider_offer_staging_cycle` gate.**

The cron as shipped fires at 03:00 UTC and will hit both failures. Two blocking defects (Bug A and Bug B) must be resolved and verified before the gate can be cleared. The drop step executes correctly but is preceded by a no-op summarize and followed by a failed prune — the lifecycle is incomplete.

**Next actions:**
1. File Bug A as a new Linear issue (function body DDL fix — T3)
2. File Bug B as a new Linear issue (index + function retarget — T2)
3. Resolve both defects in a follow-on migration
4. Re-run this manual verification sequence to confirm all 3 steps pass
5. Only then recommend gate clearance

---

## Cron-Equivalent Evidence

The three calls executed in this document match the cron body deployed by migration `20260509160906`:

```sql
SELECT * FROM public.summarize_provider_offer_history_partition(
  (timezone('utc', now()) - INTERVAL '8 days')::date  -- would be 2026-05-01 at 03:00 UTC
);
SELECT * FROM public.drop_old_provider_offer_history_partitions(7);
SELECT * FROM public.prune_provider_offers_bounded(7, 5000, 20);
```

Step 2 (drop) is confirmed working. Steps 1 and 3 will fail at the next cron execution.
