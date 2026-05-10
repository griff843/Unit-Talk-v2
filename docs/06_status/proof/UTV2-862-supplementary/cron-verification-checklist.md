# Provider-History Cron Verification Checklist

**Cron:** `nightly-retention-prune` | **Window:** 03:00 UTC (`0 3 * * *`) = 10 PM EST / 11 PM EDT  
**Migration:** `202605090001_utv2_862_cron_fix_partition_lifecycle.sql`  
**Full plan:** `docs/06_status/proof/UTV2-862-cron-verification-plan.md`

---

## PRE-WINDOW (before 03:00 UTC)

- [ ] **Migration applied** — confirm `202605090001` is in `supabase_migrations.schema_migrations`
  ```sql
  SELECT version FROM supabase_migrations.schema_migrations
  WHERE version = '202605090001';
  ```
  _Block on failure — old cron body remains live if this is empty._

- [ ] **Job definition is correct** — confirm cron body contains all 3 calls
  ```sql
  SELECT command FROM cron.job WHERE jobname = 'nightly-retention-prune';
  ```
  Must contain: `summarize_provider_offer_history_partition`, `drop_old_provider_offer_history_partitions`, `prune_provider_offers_bounded` — in that order.

- [ ] **Partition inventory captured** — record all existing partitions before the window
  ```sql
  SELECT child.relname, to_date(right(child.relname,8),'YYYYMMDD') AS day
  FROM pg_inherits
  JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
  JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
  JOIN pg_namespace ns ON child.relnamespace = ns.oid
  WHERE ns.nspname = 'public' AND parent.relname = 'provider_offer_history'
  ORDER BY child.relname;
  ```

---

## POST-WINDOW (within 30 minutes of 03:00 UTC)

- [ ] **Job fired** — row exists in `cron.job_run_details` with `start_time` in the window
  ```sql
  SELECT status, start_time, end_time, return_message
  FROM cron.job_run_details
  WHERE job_id = (SELECT jobid FROM cron.job WHERE jobname = 'nightly-retention-prune')
  ORDER BY start_time DESC LIMIT 1;
  ```

- [ ] **Status = succeeded** — `status` column is `succeeded`, not `failed`

- [ ] **No error in return_message** — `return_message` does NOT contain `ERROR` or `EXCEPTION`

- [ ] **summarize call confirmed** — `return_message` contains `rows_summarized`

- [ ] **drop call confirmed** — `return_message` contains `partitions_dropped`

- [ ] **prune call confirmed** — `return_message` contains `batches_run` or `deleted_rows`

---

## ORDERING VERIFICATION

- [ ] **Summarize before drop — dormant path** (current expected state)

  Both `provider_offer_history` and `provider_offer_line_snapshots` have 0 rows.
  `summarize` returns `rows_summarized = 0`. `drop` returns `partitions_dropped = 0` (all partitions within 7-day window) or drops only pre-existing old partitions.
  No data loss possible. Ordering is mechanically enforced by SQL block order.

- [ ] _(When write path active)_ **Snapshot row exists for Day-8 date AND partition absent from pg_inherits**
  ```sql
  -- Confirm snapshot written
  SELECT snapshot_date, count(*) FROM public.provider_offer_line_snapshots
  WHERE snapshot_date = (timezone('utc', now()) - INTERVAL '8 days')::date
  GROUP BY snapshot_date;

  -- Confirm partition dropped
  SELECT child.relname FROM pg_inherits
  JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
  JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
  JOIN pg_namespace ns ON child.relnamespace = ns.oid
  WHERE ns.nspname = 'public' AND parent.relname = 'provider_offer_history'
  ORDER BY child.relname;
  ```

---

## PARTITION INTEGRITY

- [ ] **No partition newer than cutoff was dropped**

  Compare post-run partition list against pre-window snapshot. Only partitions with `partition_day < (now() - 7 days)::date` should be absent. All others must still exist.

- [ ] **`provider_offers` row count decreased or unchanged** (never increased unexpectedly)
  ```sql
  SELECT count(*), min(created_at), max(created_at) FROM public.provider_offers;
  ```

- [ ] **`provider_offer_history` still 0 rows** (write path remains dormant)
  ```sql
  SELECT count(*) FROM public.provider_offer_history;
  ```

---

## EVIDENCE CAPTURE

- [ ] **Copy last run row to proof bundle**
  ```sql
  SELECT job_id, runid, status, start_time, end_time,
         (end_time - start_time) AS duration, return_message
  FROM cron.job_run_details
  WHERE job_id = (SELECT jobid FROM cron.job WHERE jobname = 'nightly-retention-prune')
  ORDER BY start_time DESC LIMIT 1;
  ```
  Save to: `docs/06_status/proof/UTV2-862-cron-run-evidence.json`

---

## PASS / FAIL SUMMARY

| Check | Result |
|---|---|
| Migration applied | |
| Job definition correct | |
| Job fired in window | |
| Status = succeeded | |
| No error in return_message | |
| All 3 calls present in output | |
| No unexpected partition dropped | |
| No unexpected data loss | |

**All 8 PASS → proceed to write-path activation (R3 criteria met)**  
**Any FAIL → stop. Investigate before enabling `merge_provider_offer_staging_cycle`.**
