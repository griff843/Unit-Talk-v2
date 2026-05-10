# UTV2-862: Provider-History Cron Verification Plan

**Date:** 2026-05-09  
**Cron window:** 03:00 UTC daily (`0 3 * * *`) = 10 PM EST / 11 PM EDT  
**Migration applied:** `202605090001_utv2_862_cron_fix_partition_lifecycle.sql`  
**Merge SHA:** `592bd869532e5624714803f22eafb9c4ef505b79`  
**Scope:** Preparation only. No schema changes. No migration apply. No manual cron manipulation.

---

## 1. Cron Execution Source

**Mechanism:** PostgreSQL `pg_cron` extension, hosted in Supabase.  
**Job name:** `nightly-retention-prune`  
**Schedule:** `0 3 * * *` (3:00 AM UTC)  
**Definition source:** Live `cron.job` table in Supabase — populated by migration `202605090001`.

### Verify job definition is the corrected version (run before the window):

```sql
SELECT
  jobname,
  schedule,
  command
FROM cron.job
WHERE jobname = 'nightly-retention-prune';
```

**Expected:** `command` text contains all three function calls in order:
1. `summarize_provider_offer_history_partition`
2. `drop_old_provider_offer_history_partitions`
3. `prune_provider_offers_bounded`

If any of these are absent, the migration has not been applied. **Stop — do not proceed with the window.**

---

## 2. Execution Evidence / Logging

### Primary: `cron.job_run_details`

pg_cron writes one row per execution attempt to `cron.job_run_details`. This is the authoritative execution log.

```sql
SELECT
  job_id,
  runid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time,
  (end_time - start_time) AS duration
FROM cron.job_run_details
WHERE job_id = (
  SELECT jobid FROM cron.job WHERE jobname = 'nightly-retention-prune'
)
ORDER BY start_time DESC
LIMIT 5;
```

**Key fields:**
- `status`: `succeeded` | `failed`
- `return_message`: SQL output or error text
- `start_time` / `end_time`: wall-clock window of the run
- `duration`: total execution time — abnormally short (<1s) on an otherwise active system may indicate early exit

### Secondary: Function return values

Each function returns a typed row. These appear in `return_message` within `cron.job_run_details`. Expected patterns:

| Function | Return columns | Healthy value |
|---|---|---|
| `summarize_provider_offer_history_partition` | `rows_summarized integer, snapshot_date date` | `(0, YYYY-MM-DD)` when partitions are empty; positive integer when write path is active |
| `drop_old_provider_offer_history_partitions` | `partitions_dropped integer, cutoff_date date` | `(N, YYYY-MM-DD)` where N ≥ 0 |
| `prune_provider_offers_bounded` | `batches_run integer, deleted_rows bigint, cutoff timestamptz, remaining_rows bigint` | Any non-error row |

---

## 3. Success / Failure Verification

### Gate 1 — Job ran at all

```sql
SELECT
  status,
  start_time,
  end_time,
  return_message
FROM cron.job_run_details
WHERE job_id = (
  SELECT jobid FROM cron.job WHERE jobname = 'nightly-retention-prune'
)
  AND start_time > NOW() - INTERVAL '4 hours'
ORDER BY start_time DESC
LIMIT 1;
```

**Pass:** `status = 'succeeded'` and `start_time` is within the expected window.  
**Fail:** No row (job did not fire), `status = 'failed'`, or `return_message` contains `ERROR`.

### Gate 2 — All three partition-lifecycle calls appear in return_message

```sql
SELECT return_message
FROM cron.job_run_details
WHERE job_id = (
  SELECT jobid FROM cron.job WHERE jobname = 'nightly-retention-prune'
)
ORDER BY start_time DESC
LIMIT 1;
```

Scan the `return_message` text for:
- `rows_summarized` — confirms `summarize_provider_offer_history_partition` executed
- `partitions_dropped` — confirms `drop_old_provider_offer_history_partitions` executed
- `batches_run` or `deleted_rows` — confirms `prune_provider_offers_bounded` executed

If any are absent, that call either errored or was silently skipped. Cross-reference `status` field.

### Gate 3 — No unexpected error in return_message

```sql
SELECT
  CASE
    WHEN return_message ILIKE '%error%'   THEN 'FAIL: error in return_message'
    WHEN return_message ILIKE '%exception%' THEN 'FAIL: exception in return_message'
    WHEN status = 'failed'                THEN 'FAIL: job status failed'
    ELSE 'PASS'
  END AS gate_result,
  status,
  return_message
FROM cron.job_run_details
WHERE job_id = (
  SELECT jobid FROM cron.job WHERE jobname = 'nightly-retention-prune'
)
ORDER BY start_time DESC
LIMIT 1;
```

---

## 4. Verify Summarize Completed BEFORE Partition Drop

Because pg_cron executes the job command as a single SQL block, statement order within the block is sequential and deterministic. The function invocation order is:

```
1. summarize_provider_offer_history_partition(...)
2. drop_old_provider_offer_history_partitions(7)
```

This means if both calls succeeded within the same `status = 'succeeded'` run, summarize provably executed before drop.

### Indirect ordering proof (when write path is active):

When `provider_offer_history` contains data, verify that the target snapshot date row exists in `provider_offer_line_snapshots` before confirming the partition was dropped:

```sql
-- Step A: confirm snapshot record exists for the summarized date
SELECT
  snapshot_date,
  count(*) AS snapshot_rows,
  sum(snapshot_count) AS total_source_rows
FROM public.provider_offer_line_snapshots
WHERE snapshot_date = (timezone('utc', now()) - INTERVAL '8 days')::date
GROUP BY snapshot_date;

-- Step B: confirm the partition no longer exists
SELECT
  child.relname AS partition_name
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
JOIN pg_namespace ns ON child.relnamespace    = ns.oid
WHERE ns.nspname     = 'public'
  AND parent.relname = 'provider_offer_history'
ORDER BY child.relname;
```

**Ordering confirmed if:** Step A returns rows AND Step B shows the Day-8 partition is absent from `pg_inherits`.

**Current state (write path dormant):** Both `provider_offer_history` and `provider_offer_line_snapshots` contain 0 rows. Summarize will return `rows_summarized = 0` for each call. Partition drop will drop 0 partitions if all existing partitions are within the 7-day window. This is the expected outcome during the dormant phase.

---

## 5. Verify No Unexpected Partition / Data Loss

### Pre-window snapshot (run before 03:00 UTC):

```sql
-- Capture partition inventory before cron fires
SELECT
  child.relname                                         AS partition_name,
  to_date(right(child.relname, 8), 'YYYYMMDD')         AS partition_day,
  pg_size_pretty(pg_total_relation_size(child.oid))     AS size,
  (timezone('utc', now()) - make_interval(days => 7))::date AS cutoff_7d
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
JOIN pg_namespace ns ON child.relnamespace    = ns.oid
WHERE ns.nspname     = 'public'
  AND parent.relname = 'provider_offer_history'
  AND child.relname  ~ '^provider_offer_history_p[0-9]{8}$'
ORDER BY partition_name;
```

### Post-window partition delta:

Run the same query after the cron fires. Compare the list:

- Partitions with `partition_day < cutoff_7d` **should** be absent post-run (dropped by `drop_old_provider_offer_history_partitions(7)`).
- Partitions with `partition_day >= cutoff_7d` **should** still exist.
- No partition newer than the cutoff should have been touched.

### Row count integrity check:

```sql
-- provider_offers prune: confirm rows decreased
SELECT
  count(*)                            AS total_rows,
  min(created_at)                     AS oldest_row,
  max(created_at)                     AS newest_row,
  now() - INTERVAL '7 days'           AS expected_cutoff
FROM public.provider_offers;

-- line snapshots: confirm no unexpected deletion
SELECT
  count(*)                            AS total_snapshots,
  min(snapshot_date)                  AS oldest_snapshot,
  max(snapshot_date)                  AS newest_snapshot
FROM public.provider_offer_line_snapshots;

-- history: confirm zero rows (write path still dormant)
SELECT count(*) AS history_rows FROM public.provider_offer_history;
```

**Pass criteria:**
- `provider_offers`: oldest_row should be ≥ (now - 7 days) if prune ran and had eligible rows
- `provider_offer_line_snapshots`: rows unchanged unless write path was active (currently expected = 0)
- `provider_offer_history`: 0 rows (write path dormant)

---

## 6. Cron Health Trend Query (historical context)

```sql
SELECT
  start_time::date                      AS run_date,
  status,
  (end_time - start_time)               AS duration,
  LEFT(return_message, 200)             AS message_excerpt
FROM cron.job_run_details
WHERE job_id = (
  SELECT jobid FROM cron.job WHERE jobname = 'nightly-retention-prune'
)
ORDER BY start_time DESC
LIMIT 10;
```

Use this to identify if recent runs before tonight's window were already on the corrected job body or the old (missing calls) body.

---

## 7. State at Time of This Plan

| Item | State |
|---|---|
| Migration `202605090001` | Merged (SHA `592bd869`) — awaiting apply to live Supabase |
| `provider_offer_history` rows | 0 (write path dormant) |
| `provider_offer_line_snapshots` rows | 0 |
| Active write path | Legacy `provider_offers` (8.29M rows) |
| Partition drop expected at tonight's window | 0 partitions (all within 7-day window unless pre-existing old partitions exist) |
| Write-path activation | Blocked until R3 criteria met (post-cron-confirmation) |

---

## 8. Pre-Window Prerequisites

Before the 10 PM EST / 03:00 UTC window, confirm:

1. Migration `202605090001` has been applied to live Supabase (use `list_migrations` or execute Gate 1 query)
2. `cron.job` contains the corrected job body (run the job definition query in §1)
3. Pre-window partition snapshot captured (§5 pre-window query)

If migration has not been applied, the old (broken) cron body remains live. Do not wait for tonight's window — apply the migration first.

---

## 9. Post-Run Evidence Capture

After a successful run, capture for the proof bundle:

```sql
-- Evidence capture: full last-run row
SELECT
  job_id,
  runid,
  status,
  start_time,
  end_time,
  (end_time - start_time) AS duration,
  return_message
FROM cron.job_run_details
WHERE job_id = (
  SELECT jobid FROM cron.job WHERE jobname = 'nightly-retention-prune'
)
ORDER BY start_time DESC
LIMIT 1;
```

Save the output to `docs/06_status/proof/UTV2-862-cron-run-evidence.json`.

This evidence plus the migration apply confirmation satisfies the PM-approved apply sequence step 4: "Verify summarize → drop ordering executed correctly in cron logs."
