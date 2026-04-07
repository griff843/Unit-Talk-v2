# DB Scaling Strategy — Unit Talk V2

**Authority:** Operations  
**Status:** Active  
**Last updated:** 2026-04-07

---

## Problem Statement

The Supabase free tier (500 MB) was breached on 2026-04-07 by a 90-day backfill of `provider_offers` that accumulated ~329k rows. REST API was fully throttled. Resolution required a manual `DELETE` from the Dashboard SQL editor.

This document defines the long-term, future-proof strategy so this never blocks the system again.

---

## Table Growth Classification

| Table | Growth Rate | Retention | Notes |
|---|---|---|---|
| `provider_offers` | ~3–6k rows/day | **30 days** | SGO feed snapshots — hottest writer |
| `audit_log` | ~N rows per pick lifecycle event | 90 days | No `created_at` index yet |
| `alert_detections` | Moderate | 30 days | Has `created_at` index |
| `submission_events` | Low-moderate | 90 days | Indexed by `submission_id` |
| `distribution_outbox` | Low | 7 days post-delivery | Safe to prune delivered rows |
| `distribution_receipts` | Low | 7 days post-delivery | Paired with outbox |
| `pick_lifecycle` | Low | Permanent | Core business data |
| `picks` | Low | Permanent | Core business data |
| `game_results` | ~100–200/day in-season | 1 year | Can archive off-season |
| Reference tables | Stable | Permanent | sports, leagues, teams, etc. |

---

## Phase 1 — Immediate (Free Tier, Implemented Now)

### 1.1 Provider Offers Retention
- **Policy:** 30-day rolling window
- **Script:** `scripts/prune-provider-offers.ts` — batch-deletes rows older than 30 days in 5k-row chunks to avoid timeouts
- **Status:** ✅ Policy established 2026-04-07

### 1.2 Missing Index: audit_log.created_at
`audit_log` has no `created_at` index. Any retention DELETE will do a full sequential scan.
- **Fix:** Migration to add `CREATE INDEX audit_log_created_at_idx ON public.audit_log (created_at DESC);`
- **Linear:** UTV2-437

### 1.3 Pruning Coverage — All High-Volume Tables
Add retention DELETEs for all high-growth tables beyond provider_offers:

| Table | Retention | Action |
|---|---|---|
| `audit_log` | 90 days | DELETE WHERE created_at < NOW() - INTERVAL '90 days' |
| `alert_detections` | 30 days | DELETE WHERE created_at < NOW() - INTERVAL '30 days' |
| `submission_events` | 90 days | DELETE WHERE created_at < NOW() - INTERVAL '90 days' |
| `distribution_outbox` | 7 days (delivered only) | DELETE WHERE status='delivered' AND updated_at < NOW() - INTERVAL '7 days' |
| `distribution_receipts` | 7 days | DELETE WHERE created_at < NOW() - INTERVAL '7 days' |

- **Script:** `scripts/prune-all-tables.ts` (to create)
- **Linear:** UTV2-438

---

## Phase 2 — Short Term: Upgrade + Automation (Supabase Pro)

### 2.1 Upgrade to Supabase Pro ($25/month)
- **Storage:** 8 GB (vs 500 MB free) — ~16× headroom
- **pg_cron:** Scheduled jobs run at DB level — no external cron needed
- **Connection pooling:** PgBouncer included
- **Rate limits:** REST API throttle raised significantly
- **Threshold for upgrade:** 400 MB used (80% of current free limit)

### 2.2 pg_cron Scheduled Pruning
Once on Pro tier, enable `pg_cron` and create a scheduled job that runs all retention deletes nightly:

```sql
SELECT cron.schedule(
  'nightly-retention-prune',
  '0 3 * * *',  -- 3am UTC daily
  $$
    DELETE FROM public.provider_offers WHERE created_at < NOW() - INTERVAL '30 days';
    DELETE FROM public.audit_log WHERE created_at < NOW() - INTERVAL '90 days';
    DELETE FROM public.alert_detections WHERE created_at < NOW() - INTERVAL '30 days';
    DELETE FROM public.submission_events WHERE created_at < NOW() - INTERVAL '90 days';
    DELETE FROM public.distribution_outbox WHERE status = 'delivered' AND updated_at < NOW() - INTERVAL '7 days';
    DELETE FROM public.distribution_receipts WHERE created_at < NOW() - INTERVAL '7 days';
  $$
);
```

**Linear:** UTV2-439

### 2.3 Ingestor-Supervisor Pruning Hook (Free-Tier Workaround)
Until pg_cron is available, add a weekly pruning trigger to `scripts/ingestor-supervisor.ts` that runs `prune-all-tables.ts` as a child process on startup.

**Linear:** UTV2-440

---

## Phase 3 — Medium Term: Table Partitioning

### 3.1 Partition provider_offers by Month
Convert `provider_offers` to a range-partitioned table on `created_at`. Monthly partitions allow instant `DROP TABLE` on old partitions (zero-cost vs row-level DELETE).

```sql
-- Example: new partition structure
CREATE TABLE public.provider_offers (
  ...
) PARTITION BY RANGE (created_at);

CREATE TABLE provider_offers_2026_04 PARTITION OF provider_offers
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```

**Impact:** DROP old partition = microseconds. No batch delete loops needed.  
**Linear:** UTV2-441 (requires careful migration, T1 risk tier)

### 3.2 Partition audit_log by Month
Same pattern as provider_offers. audit_log will become the second-largest table as pick volume grows.

**Linear:** UTV2-442

---

## Phase 4 — Long Term: Cold Archival

### 4.1 Archive old picks + settlements to cold storage
Picks and settlement_records must never be deleted — they're core business truth. But they can be archived off-hot-Supabase after 2 years.

- **Mechanism:** Export to Supabase Storage (S3-compatible) or Cloudflare R2 as monthly JSON/parquet snapshots
- **Hot tier:** Supabase Postgres — current season + 1 trailing year
- **Cold tier:** Object storage — everything older
- **Query path:** Analytics queries against cold tier use Supabase Edge Functions or direct S3 queries

**Linear:** UTV2-443 (not started until Pro tier is stable)

### 4.2 Read Replica for Analytics
If operator-web or command-center queries start impacting write performance:
- Supabase Pro includes 1 read replica option
- Route all SELECT-only operator queries to the replica

---

## Storage Budget Model

At current SGO ingest rate (~5k rows/day × ~500 bytes/row = ~2.5 MB/day for provider_offers):

| Retention | Size (provider_offers only) |
|---|---|
| 30 days | ~75 MB |
| 60 days | ~150 MB |
| 90 days | ~225 MB |

With audit_log, receipts, alerts adding ~50 MB/month, total hot-tier growth is approximately **125 MB/month at current scale** with 30-day provider_offers retention active.

Free tier lasts ~4 months at this rate (from zero). Pro tier (8 GB) lasts **5+ years**.

---

## Upgrade Trigger Criteria

Upgrade to Supabase Pro when ANY of the following:
1. Storage exceeds 400 MB (80% free tier)
2. REST API throttling blocks ingestor for >5 minutes
3. Pick submission volume exceeds 1,000/day (connection pool pressure)
4. pg_cron required for reliable scheduled pruning

---

## Implementation Order

| Phase | Action | Linear | Priority |
|---|---|---|---|
| 1a | Add `audit_log.created_at` index | UTV2-437 | High |
| 1b | Create `prune-all-tables.ts` script | UTV2-438 | High |
| 2a | Add pruning hook to ingestor-supervisor | UTV2-440 | Medium |
| 2b | Upgrade to Supabase Pro + pg_cron | UTV2-439 | Medium (threshold-based) |
| 3a | Partition `provider_offers` by month | UTV2-441 | Low (post-Pro upgrade) |
| 3b | Partition `audit_log` by month | UTV2-442 | Low |
| 4a | Cold archival for picks/settlements | UTV2-443 | Long-term |

---

## Anti-Patterns to Avoid

- **No backfills without retention plan** — every backfill must define its TTL before execution
- **No DELETE in tight loops** — always batch (5k rows max per transaction)
- **No index-free pruning** — add `created_at` index before scheduling retention deletes
- **No storage checks bypassed** — ops:brief must surface storage % used
