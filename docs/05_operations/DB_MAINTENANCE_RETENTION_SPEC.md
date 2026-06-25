# DB Maintenance, Retention, and Write-Path Architecture Spec

**Issue:** UTV2-1295  
**Lane type:** SPEC-ONLY — no SQL execution, no DDL, no code changes, no DB mutations  
**Authority:** Operations / PM ratification required before any execution  
**Status:** Draft — pending PM ratification  
**Created:** 2026-06-24  

---

## Incident Summary

On 2026-06-23, an oversized MLB odds archive write (17.8 MB) timed out PostgREST and starved settlement for ~40 hours. The immediate fix (UTV2-1294) bounded the archive write with a write-timeout guard and a size-guard (payload_too_large metadata + disk spool for oversized payloads).

This document specifies the durable architecture to prevent the same incident class from recurring. It is organized into seven sections, each with explicit PM gates before execution.

---

## Section 1: Hot-Table Retention Strategy

### 1.1 Background and Rationale

Three tables accumulate unbounded operational data with no automated retention:

- **`system_runs`** — ~3.3M rows, 1.2 GB, dead autovacuum, stale stats. Caused 120s statement timeouts in the UTV2-1294 incident. Operational context for debugging is needed for 7 days; compliance buffer extends this to 30 days.
- **`raw_payloads`** — TOAST-heavy large JSON payloads from provider ingestion. No current retention. Payloads older than 30 days have no operational value; they are superseded by downstream tables (`provider_offer_history`, `odds_snapshots`).
- **`odds_snapshots`** — Large JSON blobs, TOAST-heavy. Operational window is 7 days; 30-day retention adds buffer for incident investigation.

### 1.2 Retention Windows

| Table | Retention Window | Rationale |
|---|---|---|
| `system_runs` | 30 days | Incident analysis showed 7-day coverage sufficient; 30d provides buffer for post-incident investigations (matches the UTV2-1294 timeline) |
| `raw_payloads` | 30 days | Downstream tables carry parsed data; raw bytes beyond 30d have no operational value; error rows exempted (see §1.4) |
| `odds_snapshots` | 30 days | Same as raw_payloads; current partition pattern already uses `snapshot_at`; 30d matches provider_offer_history lifecycle |

### 1.3 Batched DELETE Design

All retention deletes MUST be batched. A single unbounded DELETE on a multi-million-row table causes the same statement timeout class that triggered UTV2-1294.

**Design rules (non-negotiable):**

1. Batch size: 1,000 rows per pass (not 5,000 — hot TOAST tables need smaller batches to avoid bloat cascades)
2. Statement timeout per pass: 10 seconds (fail the batch pass, not the job)
3. Sleep between passes: 500ms (allow autovacuum to reclaim dead tuples between passes)
4. Total job timeout: 30 minutes (capped; do not run to completion if the table is pathologically large — alert and stop)
5. Progress logging: log rows deleted per pass, cumulative rows deleted, elapsed time
6. Idempotent: re-running the job produces no error if all eligible rows are already deleted

**Example pseudo-code structure (PM-gated, do not execute):**

```typescript
// EXAMPLE ONLY — PM approval required before execution
// scripts/db-retention/retain-hot-tables.ts

const BATCH_SIZE = 1000;
const STATEMENT_TIMEOUT_MS = 10_000;
const SLEEP_BETWEEN_BATCHES_MS = 500;
const MAX_JOB_DURATION_MS = 30 * 60 * 1000;

async function batchDelete(table: string, cutoffDate: Date, carveOut: string) {
  const jobStart = Date.now();
  let totalDeleted = 0;
  let pass = 0;

  while (Date.now() - jobStart < MAX_JOB_DURATION_MS) {
    // Example SQL — do not run without PM approval:
    // DELETE FROM <table>
    // WHERE id IN (
    //   SELECT id FROM <table>
    //   WHERE created_at < $cutoffDate
    //   AND NOT (<carveOut>)
    //   ORDER BY created_at ASC
    //   LIMIT $BATCH_SIZE
    // )
    const rowsDeleted = await runBatchDeleteWithTimeout(table, cutoffDate, carveOut, BATCH_SIZE, STATEMENT_TIMEOUT_MS);

    totalDeleted += rowsDeleted;
    pass++;
    log(`[${table}] pass=${pass} deleted=${rowsDeleted} total=${totalDeleted}`);

    if (rowsDeleted < BATCH_SIZE) break; // done
    await sleep(SLEEP_BETWEEN_BATCHES_MS);
  }

  if (Date.now() - jobStart >= MAX_JOB_DURATION_MS) {
    alertOps(`[${table}] retention job hit max duration, ${totalDeleted} deleted — rerun needed`);
  }
}
```

### 1.4 Carve-Out Conditions

Rows that match any carve-out condition MUST NOT be deleted, regardless of age.

**`system_runs` carve-outs:**

> **Schema constraint:** `system_runs.status` CHECK allows: `'running'`, `'succeeded'`, `'failed'`, `'cancelled'`. There is no `'error'` value.

- `status = 'failed'` AND `created_at > NOW() - INTERVAL '90 days'` — failed-run rows retained 90 days for incident analysis
- `status = 'running'` — active runs are never eligible for deletion (no `finished_at` set)

**`raw_payloads` carve-outs:**

> **Schema note:** `raw_payloads` has no `metadata` column in the current schema (columns: id, provider_key, league, run_id, kind, payload_hash, payload, snapshot_at, created_at). Carve-out conditions based on `kind` are possible now; carve-outs based on payload content require a future schema migration lane to add a `metadata` column.

- `kind = 'error'` (or equivalent error-payload kind) — error-class rows retained 90 days. Confirm actual kind values in schema before execution lane.
- Additional carve-outs (e.g., "large payload evidence rows") require a `metadata` column — defer to the schema migration lane (§2.2).

**`odds_snapshots` carve-outs:**

> **Schema note:** `odds_snapshots` has no `metadata` column (columns: id, provider_key, market_key, league, run_id, raw_payload_id, snapshot_at, price_blob, prior_snapshot_id, created_at). `pick_offer_snapshots` has no `odds_snapshot_id` or `snapshot_kind` column. Carve-outs below use only real schema columns.

- `prior_snapshot_id IS NULL AND created_at > NOW() - INTERVAL '1 year'` — root/baseline snapshots (no prior snapshot, i.e., first in a chain) retained 1 year for CLV reference
- `snapshot_at > NOW() - INTERVAL '90 days'` — recent snapshots always exempt; only older snapshots are eligible for deletion

### 1.5 Execution Mechanism

**Recommended:** GitHub Actions scheduled workflow (not pg_cron, not ingestor hook).

Rationale: pg_cron requires Supabase Pro and adds DB-level coupling. Ingestor hooks add startup latency risk. GHA gives a clear audit trail, independent failure domain, and is already used for the Track A monitor.

**Proposed schedule:** 3:00 AM UTC daily (`0 3 * * *`)

**Proposed workflow file (to be created in a future execution lane):** `.github/workflows/db-retention.yml`

The workflow should:
1. Run as a read-write job with `SUPABASE_SERVICE_ROLE_KEY` secret
2. Execute each table's retention script sequentially (not parallel — avoid write contention)
3. Post a summary to Linear UTV2-1295 (or its successor monitoring issue) on completion
4. Alert on any failure (do not silently swallow errors)

**PM gate:** Batched DELETE scripts require PM approval per table, maintenance window, and pre/post size evidence (see §7).

---

## Section 2: Partition and Archive Strategy

### 2.1 `system_runs` — RANGE Partitioning by Month

**Current state:** 3.3M rows, 1.2 GB, unpartitioned heap, dead autovacuum.

**Proposed:** Convert to RANGE partitioning on `created_at` with monthly partitions.

**Why partitioning over batched DELETE:** Once partitioned, retiring a month's data is a `DETACH PARTITION` + `DROP TABLE` — microseconds and zero-cost vs hours of batched deletes. Autovacuum can target individual partitions instead of a 1.2 GB heap.

**Migration approach (PM-gated, execution lane required):**

```sql
-- EXAMPLE ONLY — do not run without PM approval and a dedicated migration lane

-- Step 1: Create the new partitioned parent table
CREATE TABLE public.system_runs_partitioned (
  LIKE public.system_runs INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- Step 2: Create monthly partitions for the retention window (last 30 days + future)
CREATE TABLE system_runs_2026_06 PARTITION OF system_runs_partitioned
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE system_runs_2026_07 PARTITION OF system_runs_partitioned
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- Step 3: Backfill only the retention window (last 30 days) — NOT the full 3.3M row history
-- INSERT INTO system_runs_partitioned SELECT * FROM system_runs WHERE created_at > NOW() - INTERVAL '30 days';

-- Step 4: Rename tables (requires application write pause or blue/green)
-- Step 5: Create default partition to catch future overflow
CREATE TABLE system_runs_default PARTITION OF system_runs_partitioned DEFAULT;
```

**Trigger threshold:** Execute this migration when retention DELETEs are insufficient to keep `system_runs` below 500 MB, OR when autovacuum continues to fail after retention scripts run for 2+ weeks.

**PM approval gate:** Required. This is a DDL change with rename. T1 risk tier.

**Pre/post evidence required:**
- `pg_total_relation_size('system_runs')` before and after
- `pg_stat_user_tables` last_vacuum / last_analyze before and after
- `SELECT COUNT(*) FROM system_runs` before and after

### 2.2 `raw_payloads` — External Object-Store Archival

**Current state:** TOAST-heavy JSON payloads, no retention, no size bound enforced pre-UTV2-1294.

**Proposed:** Payloads above the size threshold (see §3) should never be written to Postgres as raw bytes. For existing oversized rows already in the table: export to Hetzner Object Storage (S3-compatible), then delete the Postgres row (payload is preserved in object store).

> **Schema constraint:** `raw_payloads` has no `metadata` column in the current schema. Three possible approaches for the execution lane:
>
> - **Option A (no schema change, re-insert):** Write payload to object store → DELETE the Postgres row → INSERT a new row with `payload = null` and `kind = 'archived'`. Requires confirming that downstream consumers tolerate `kind = 'archived'` rows with null payload.
>
> - **Option B (schema migration first):** Add a `metadata JSONB` column in a dedicated migration lane → then UPDATE rows with `metadata->>'archived_url'`. This is the cleaner in-place approach but requires a separate T1 migration lane before any archival writes.
>
> - **Option C (append-only companion table — recommended):** Create a `raw_payloads_archive_log` companion table (id, raw_payload_id, object_store_url, archived_at, payload_bytes) in a migration lane → INSERT a row linking the archived URL to the original `raw_payloads.id` → optionally NULL out `raw_payloads.payload` (if tolerated by consumers). The original `raw_payloads` row is preserved; the archive URL is recorded without mutating `raw_payloads` schema. This is the safest append-only path and requires a dedicated migration lane.
>
> The execution lane for this section must choose one option and get PM approval for the schema approach. Do not write an UPDATE against `raw_payloads.metadata` — that column does not exist in the current schema.

**Migration approach for existing rows (PM-gated, read-only identification query):**

```sql
-- EXAMPLE ONLY — read-only identification query, do not mutate without PM approval

-- Identify rows eligible for archival
SELECT id, octet_length(payload::text) AS payload_bytes, created_at, kind
FROM public.raw_payloads
WHERE octet_length(payload::text) > 512 * 1024  -- 512 KB threshold
ORDER BY payload_bytes DESC
LIMIT 100;
```

The archival script (to be implemented in a future execution lane) should:
1. Read the row
2. Write the payload to object store at `s3://unit-talk-archive/raw_payloads/{year}/{month}/{id}.json`
3. On success: execute the approach chosen above (Option A DELETE+re-insert, or Option B UPDATE after migration)
4. Log the operation (archive URL, payload size, id)
5. On object store failure: abort and alert — do NOT delete the Postgres row

**PM gate:** Separate execution lane required. Schema approach (Option A vs B) must be PM-approved before any write.

### 2.3 `odds_snapshots` — TTL-Based Drop of Old Partitions

**Current state:** TOAST-heavy, large JSON. Partition status unknown (check schema).

**Proposed:** If already partitioned, drop partitions older than 30 days. If not partitioned, apply the same RANGE(created_at) monthly pattern as §2.1 before enabling any partition drops.

**Trigger threshold:** Execute partition drop when any partition's `pg_total_relation_size` exceeds 200 MB.

**PM gate:** Required. DROP PARTITION is irreversible without object-store backup in place.

**Sequencing dependency:** Object-store archival (§2.2 / §3) must be in place and proven before any `odds_snapshots` partition drop. Closing-for-CLV carve-outs (§1.4) must be verified exported before drop.

---

## Section 3: Object-Storage / External Raw-Payload Archive

### 3.1 Durable Answer for Large Provider Payloads

**Current state (post-UTV2-1294):** When a payload exceeds the write-timeout guard, the system writes `payload_too_large` metadata to the DB and spools the payload to disk (`/tmp/payloads/{id}.json` or similar). This is a fail-safe, not a durable solution: disk spools are ephemeral, lost on restart, and not queryable.

**Proposed durable answer:** Write large payloads to Hetzner Object Storage first. Store the URL in the DB. Never write raw bytes above the threshold to Postgres.

### 3.2 Size Threshold

**Threshold: 512 KB per payload**

Justification: The UTV2-1294 incident payload was 17.8 MB — 35× this threshold. The threshold is set conservatively so that normal SGO provider payloads (which are typically 10–100 KB) are never affected. TOAST page size is 2 KB; 512 KB = 256 TOAST pages = already well into the pathological range for write throughput.

### 3.3 Storage Bucket Structure

```
s3://unit-talk-archive/
  raw_payloads/
    {YYYY}/
      {MM}/
        {payload_id}.json.gz     # gzip compressed
  odds_snapshots/
    {YYYY}/
      {MM}/
        {snapshot_id}.json.gz
```

**Bucket policy:**
- Private (no public access)
- Versioning: disabled (content is immutable once written)
- Lifecycle rule: delete objects older than 90 days (configures the true archive TTL independent of DB)
- Region: same Hetzner region as the application server to minimize egress latency

### 3.4 Write Path (Future Forward Flow)

For new writes (after the execution lane implements this):

```
Ingestor receives payload
  ├─ payload_bytes <= 512 KB → write to Postgres normally
  └─ payload_bytes > 512 KB
       ├─ write to object store: s3://unit-talk-archive/raw_payloads/{year}/{month}/{id}.json.gz
       │    └─ on success: record archive per the chosen schema approach (Option A/B/C from §2.2)
       │         Option A: INSERT new row with payload=null, kind='archived'
       │         Option B: UPDATE payload=null, metadata->>'archived_url' (after migration lane)
       │         Option C: INSERT into raw_payloads_archive_log (after migration lane)
       │         NOTE: approach must be PM-approved in the execution lane — do not mutate without approval
       │    └─ on failure: fall back to disk spool (UTV2-1294 guard)
       │         DO NOT block settlement — spool and continue
       └─ log: object_store_write_result = 'success' | 'failed_disk_spool' + archive URL
```

### 3.5 Failure Mode: Fail-Open for Archive Writes

**Critical invariant:** Object-store write failure MUST NOT block settlement.

If the object store is unreachable:
1. Fall back to disk spool (existing UTV2-1294 behavior)
2. Log locally: `archive_failed=true, disk_spooled=true` (not written to DB — `raw_payloads` has no `metadata` column in current schema)
3. Log an alert (Track A monitor alert action: see §5)
4. Continue ingestor cycle normally

Settlement writes (`game_results` insert, completed lifecycle transition) are completely independent of this path and must never be affected.

---

## Section 4: Write-Path Isolation Boundary

### 4.1 The Problem

The UTV2-1294 incident demonstrated that a single telemetry/archive write (system_runs row + raw_payloads blob) can starve settlement for 40 hours via PostgREST connection exhaustion. The write-timeout guard introduced in UTV2-1294 is necessary but not sufficient: a 120s timeout is still 120s of a PostgREST connection held by a non-critical write.

### 4.2 Settlement-Critical vs Archive/Telemetry Writes

**Settlement-critical (fail-closed, never degrade):**

| Table | Write | Why critical |
|---|---|---|
| `game_results` | INSERT | The primary settlement input |
| `pick_lifecycle` | INSERT (lifecycle event, append-only) | Event-sourced; no UPDATE operations exist on this table |
| `distribution_outbox` | INSERT | Delivery queue — missing row = silent drop |
| `picks` | UPDATE (result fields) | Core business truth |

**Archive/telemetry (fail-open, allowed to degrade):**

| Table | Write | Failure mode |
|---|---|---|
| `system_runs` | INSERT | Skip the row — log locally, do not retry |
| `raw_payloads` | INSERT | Disk spool (UTV2-1294) or object store |
| `odds_snapshots` | INSERT | Skip if write fails — source data still in `provider_offer_history` |
| `audit_log` | INSERT | Log locally, batch retry on next cycle |
| `alert_detections` | INSERT | Log locally, skip |

### 4.3 Proposed: Async Telemetry Worker with Bounded Queue

**Architecture:**

```
Settlement path (synchronous, fail-closed):
  Ingestor → game_results INSERT → pick_lifecycle INSERT → outbox INSERT
  └─ if any step fails → hard error, ingestor stops cycle, alerting fires

Telemetry path (async, fail-open):
  Ingestor → enqueue(TelemetryEvent) → bounded in-memory queue
                                          └─ TelemetryWorker dequeues
                                               └─ system_runs INSERT (10s timeout)
                                               └─ raw_payloads write (object store first, disk spool fallback)
                                               └─ if DB write fails → log + drop (do NOT retry indefinitely)
```

**Queue bounds:**
- Max queue depth: 500 events
- If queue is full: drop oldest telemetry events (not settlement events — settlement never enters this queue)
- Log queue-full events as alerts

**Existing UTV2-1294 write-timeout guard** becomes the innermost defense for any telemetry write that bypasses the queue (e.g., during worker startup).

### 4.4 Which Writes Must Be Isolated

The following writes MUST move to the async telemetry worker (fail-open) in the execution lane:
- All `system_runs` inserts
- All `raw_payloads` inserts (or object-store writes above threshold)
- All `odds_snapshots` inserts
- All `audit_log` inserts (except those recording settlement outcomes — those are critical)

The following writes MUST remain synchronous and fail-closed:
- `game_results` inserts
- `pick_lifecycle` completed-transition updates
- `distribution_outbox` inserts
- `picks` result-field updates

### 4.5 Execution Lane Requirements

This isolation refactor is a separate runtime lane (not part of UTV2-1295 spec scope). It requires:
- T1 tier (runtime change to the critical settlement path)
- `pnpm test:db` green
- Evidence bundle proving that settlement writes complete in <5s under simulated telemetry write failure
- PM approval before merge

---

## Section 5: DB-Health Tripwires and Monitors

> **Separation from execution lanes:** All checks in this section are **read-only SELECTs**. No PM approval is required for the read queries themselves. A T3 GHA monitoring lane implementing these checks can start immediately after spec ratification — it is independent of all PM-gated execution actions in Sections 1–4. Do not block Section 5 on Sections 1–4. The SQL examples below are READ-ONLY and are safe to inspect but must not be scheduled without the GHA workflow lane.

### 5.1 Overview

A DB health check should run every 6 hours (aligned with the Track A monitor schedule `23 */6 * * *`). It may run in the same GHA workflow or a separate one. All checks are read-only. Alert action for every check: log + post to the relevant Linear issue + fire Track A monitor trigger if thresholds exceeded.

### 5.2 Check 1: Autovacuum Staleness

**What:** `pg_stat_user_tables` — last_analyze and last_vacuum age per hot table.

**Threshold:** Alert if `last_analyze IS NULL` OR `last_vacuum IS NULL` OR `NOW() - last_analyze > INTERVAL '24 hours'` for any hot table.

**Example query (read-only — safe to inspect now; schedule implementation via T3 GHA lane):**

```sql
SELECT
  schemaname,
  relname,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  n_dead_tup,
  n_live_tup,
  ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_tup_pct
FROM pg_stat_user_tables
WHERE relname IN ('system_runs', 'raw_payloads', 'odds_snapshots', 'provider_offer_history', 'game_results')
ORDER BY last_vacuum ASC NULLS FIRST;
```

**Alert action:** If `last_vacuum IS NULL` for any hot table → post to Linear + page PM. If `dead_tup_pct > 20%` → post alert + recommend `ANALYZE` (PM-gated before execution).

### 5.3 Check 2: Table Size Growth Rate

**What:** `pg_relation_size` + `pg_total_relation_size` for hot tables.

**Threshold:** Alert if any hot table exceeds:
- `system_runs`: 500 MB
- `raw_payloads`: 300 MB
- `odds_snapshots`: 300 MB

Alert if growth rate (compared to previous check) exceeds 50 MB / 6 hours for any hot table.

**Example query (read-only):**

```sql
SELECT
  relname,
  pg_size_pretty(pg_relation_size(oid)) AS table_size,
  pg_size_pretty(pg_total_relation_size(oid)) AS total_size_with_toast,
  pg_total_relation_size(oid) AS total_bytes
FROM pg_class
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE nspname = 'public'
  AND relname IN ('system_runs', 'raw_payloads', 'odds_snapshots', 'provider_offer_history', 'game_results')
ORDER BY pg_total_relation_size(oid) DESC;
```

**Alert action:** Post to Linear with table name, current size, and size delta since last check.

### 5.4 Check 3: Statement Timeout Error Rate

**What:** PostgREST / ingestor log parsing for `statement timeout` errors (Postgres error code `57014`).

**Note:** `pg_stat_activity` shows only currently running queries. Completed statements (including those that timed out) are captured in `pg_stat_statements` (requires the extension) or in the ingestor logs. Prefer ingestor log parsing until `pg_stat_statements` availability is confirmed.

**Threshold:** Alert if `statement timeout` appears more than 3 times in any 1-hour window in ingestor logs.

**Query for pg_stat_statements (if extension available):**

```sql
-- requires pg_stat_statements extension
SELECT
  query,
  calls,
  mean_exec_time,
  max_exec_time,
  rows
FROM pg_stat_statements
WHERE mean_exec_time > 5000  -- 5 seconds average
ORDER BY mean_exec_time DESC
LIMIT 20;
```

**Alert action:** Post to Linear with the query text (truncated to 200 chars) and call count. If count > 10 in 1 hour → page PM.

### 5.5 Check 4: TOAST Bloat Estimate

**What:** Estimate TOAST bloat for `raw_payloads` and `odds_snapshots` by comparing `pg_relation_size` (heap) vs `pg_total_relation_size` (heap + TOAST + indexes).

**Threshold:** Alert if `(total_size - heap_size) / total_size > 0.8` (TOAST + indexes are more than 80% of total table size).

**Example query (read-only):**

```sql
SELECT
  relname,
  pg_size_pretty(pg_relation_size(oid)) AS heap_size,
  pg_size_pretty(pg_total_relation_size(oid) - pg_relation_size(oid)) AS toast_plus_index_size,
  pg_size_pretty(pg_total_relation_size(oid)) AS total_size,
  ROUND((pg_total_relation_size(oid) - pg_relation_size(oid))::numeric / NULLIF(pg_total_relation_size(oid), 0) * 100, 1) AS toast_pct
FROM pg_class
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE nspname = 'public'
  AND relname IN ('raw_payloads', 'odds_snapshots');
```

**Alert action:** TOAST pct > 80% → recommend payload archival migration (§2.2 / §3). Post to Linear.

### 5.6 Check 5: Ingestor and Pipeline Health

The following checks are already tracked by the Track A monitor (`scripts/ops/track-a-monitor.ts`, GHA `.github/workflows/track-a-monitor.yml`). The DB health check MUST NOT duplicate them — instead, reference and link to the Track A monitor output.

**Already tracked (do not re-implement):**
- Ingestor RestartCount
- `finalized_results_in` count
- Completed lifecycle transitions
- `game_results` freshness

**New DB-health check additions (not in Track A monitor):**
- `provider_offer_history` partition count and newest partition age
- `system_runs` row count and max `created_at` age (proxy for retention script success)

**Example query for partition health (PM-gated, read-only):**

```sql
-- EXAMPLE ONLY
SELECT
  COUNT(*) AS partition_count,
  MAX(pg_partition_tree.relid::regclass::text) AS newest_partition_name
FROM pg_partition_tree('provider_offer_history')
WHERE isleaf;
```

### 5.7 Check Execution Summary

| Check | Frequency | Threshold | Alert Action |
|---|---|---|---|
| Autovacuum staleness | Every 6 hours | last_analyze NULL or > 24h old | Post Linear + page PM if NULL |
| Table size growth | Every 6 hours | system_runs > 500 MB, others > 300 MB, growth > 50 MB/6h | Post Linear |
| Statement timeout rate | Every 6 hours (log parse) | > 3 timeouts/hour | Post Linear; > 10/hour → page PM |
| TOAST bloat estimate | Every 6 hours | TOAST pct > 80% | Recommend archival, post Linear |
| Partition health | Every 6 hours | newest partition > 30 days old | Post Linear |

---

## Section 6: Proof-Based Handoff Standard

### 6.1 Rule (Enforceable)

No future handoff may claim "DB recovered" or "table health restored" without embedding ALL of the following evidence, measured before and after the remediation:

| Evidence Field | Format | Notes |
|---|---|---|
| `last_analyze` (before) | ISO 8601 timestamp or NULL | From `pg_stat_user_tables.last_analyze` |
| `last_analyze` (after) | ISO 8601 timestamp | Must be within 1 hour of the handoff claim |
| `last_vacuum` (before) | ISO 8601 timestamp or NULL | From `pg_stat_user_tables.last_vacuum` |
| `last_vacuum` (after) | ISO 8601 timestamp | Must be within 1 hour of the handoff claim |
| `pg_total_relation_size` (before) | Bytes (integer) | Per affected table |
| `pg_total_relation_size` (after) | Bytes (integer) | Per affected table |
| `statement_timeout_error_count` (before) | Integer | From log parse or pg_stat_statements |
| `statement_timeout_error_count` (after) | Integer | Over the same measurement window |
| `n_dead_tup` (before) | Integer | Dead tuple count before remediation |
| `n_dead_tup` (after) | Integer | Dead tuple count after remediation |

### 6.2 Proof Must Be SHA-Bound

All evidence must be stamped to a commit SHA (the merge SHA), not a branch tip. A branch tip is mutable; it is not authoritative.

Format (must appear verbatim in the proof bundle):

```
## DB Recovery Evidence

Merge SHA: <sha>
Measurement time: <ISO 8601>

### system_runs
last_analyze before: NULL
last_analyze after: 2026-06-23T14:33:00Z
last_vacuum before: NULL
last_vacuum after: 2026-06-23T14:33:05Z
pg_total_relation_size before: 1258291200 (1.2 GB)
pg_total_relation_size after: 987654321 (942 MB)
n_dead_tup before: 3200000
n_dead_tup after: 0
statement_timeout_count (1h window) before: 47
statement_timeout_count (1h window) after: 0
```

### 6.3 Precedent: UTV2-1294 Handoff Failure

The UTV2-1294 incident handoff claimed "DB recovered" while `last_analyze` and `last_vacuum` were NULL for `system_runs`. This is the exact failure this standard prevents. No future handoff may be accepted without the evidence block above. CI enforcement of this standard is a recommended follow-up in a future lane.

---

## Section 7: PM Gates and Execution Sequencing

All items below require explicit PM approval. No execution may begin without PM sign-off. Each action that mutates production state requires a maintenance window.

### 7.1 Gate Table

| Action | Gate | Sequencing | Lane Type |
|---|---|---|---|
| Batched DELETE — `system_runs` | PM approval, maintenance window, pre/post size evidence | Run after §7.4 (health monitors) are live | T2 |
| Batched DELETE — `raw_payloads` | PM approval, maintenance window, pre/post size evidence | Run after system_runs DELETE proven safe | T2 |
| Batched DELETE — `odds_snapshots` | PM approval, maintenance window, pre/post size evidence | Run after raw_payloads DELETE proven safe | T2 |
| `system_runs` partitioning DDL | PM approval, maintenance window, T1 tier, pre/post size evidence | Only after retention DELETEs are insufficient | T1 |
| `raw_payloads` → object-store archival | PM approval, separate lane, additive (no rollback) | Requires object-store bucket provisioned first | T2 |
| `odds_snapshots` partition drop | PM approval, separate lane | Requires object-store archival lane Done and carve-outs verified | T1 |
| Object-store provisioning (Hetzner bucket) | PM approval | Can run in parallel with retention DELETE lanes | Ops task |
| Write-path isolation refactor (§4) | PM approval, T1 proof, runtime lane | Separate lane; must not overlap with any schema migration lane | T1 |
| DB health monitor GHA workflow | PM approval, T3 (read-only GHA) | Can start immediately after spec ratification | T3 |

### 7.2 Recommended Execution Order

1. **PM ratifies this spec** (UTV2-1295 Done)
2. **DB health monitor** GHA workflow lane (T3, read-only, immediate value, no risk)
3. **Object-store bucket provisioning** (Ops task, parallel-safe)
4. **Batched DELETE — `system_runs`** (T2, highest impact, earliest win)
5. **Batched DELETE — `raw_payloads`** (T2, after system_runs proven)
6. **Object-store archival for large payloads** (T2, additive, after bucket proven)
7. **Batched DELETE — `odds_snapshots`** (T2, after raw_payloads pattern proven)
8. **Write-path isolation refactor** (T1, separate runtime lane, after all DELETEs proven)
9. **`system_runs` partitioning** (T1, only if needed after retention DELETEs run 2+ weeks)
10. **`odds_snapshots` partition drop** (T1, only after §6 and §9 carve-outs proven)

### 7.3 Maintenance Window Requirements

- All DELETE operations: off-peak window (3–5 AM UTC)
- All DDL (CREATE TABLE, RENAME): coordinated maintenance window with ingestor paused
- PM must acknowledge before and after each maintenance window
- Pre-execution: capture all proof evidence fields from §6.1 (before values)
- Post-execution: capture all proof evidence fields from §6.1 (after values) and embed in lane proof bundle

---

## Appendix A: Tables Not Covered by This Spec

The following tables were analyzed and determined to not require action in this spec:

| Table | Status |
|---|---|
| `provider_offer_history` | Already RANGE-partitioned on `snapshot_at`, 60 partitions, 1.39M rows — partition health check added to §5 monitor but no immediate action needed |
| `picks` | Core business truth — permanent retention, no DELETE |
| `pick_lifecycle` | Core business truth — permanent retention, no DELETE |
| `game_results` | In-season: ~100–200 rows/day; settlement truth — permanent retention, no DELETE |
| `distribution_outbox` | Covered by existing retention policy in `DB_SCALING_STRATEGY.md` (7 days post-delivery) |

---

## Appendix B: Cross-References

| Document | Relevance |
|---|---|
| `docs/05_operations/DB_SCALING_STRATEGY.md` | Earlier retention policy; this spec supersedes it for the tables covered here |
| `docs/06_status/proof/UTV2-1276/MONITOR_SPEC.md` | Track A monitor spec; §5.6 references it |
| `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` | Proof bundle format |
| `docs/05_operations/EXECUTION_TRUTH_MODEL.md` | Truth hierarchy; §6.2 SHA binding |
| UTV2-1294 proof bundle | Incident evidence; establishes the before-state for §6.3 |
