# UTV2-1981 — production apply design

MERGE_SHA: pending merge

Draft for Griff; nothing in this packet has been executed. Separate Griff production
authorization is required after PM review, governed merge, and staging evidence.
No staging or production DDL is authorized for this executor.

## Preconditions

Record the approved issue, PR, merge SHA, operator, UTC time, target identity and
rollback authorization. Production must be `zfzdnfwdarxucxtaojxm`; staging evidence
must target `xskgrzbteyqdufktjrjx` through `staging-ci` with `CI_SUPABASE_*` credentials.
Never print credentials. Confirm migration history, disk headroom for two scans and
index construction, active index builds, active sessions and long transactions:

```sql
SELECT to_regclass('public.picks_updated_at_idx') AS existing_object;
SELECT pid, state, xact_start, query_start, wait_event_type, wait_event
FROM pg_stat_activity WHERE datname = current_database();
SELECT * FROM pg_stat_progress_create_index;
```

Require the index name to be absent before the build. If present, inspect its
catalog definition and `indisvalid`/`indisready` below; stop for reconciliation,
including an invalid or differently shaped object. `IF NOT EXISTS` is not a
validity check. Check disk through the authorized infrastructure monitor.

Staging build duration and size have **not been measured**. Before authorization,
record staging build time and `pg_relation_size`, and estimate production duration
and bytes as staging measurements multiplied by production/staging table bytes
(and row ratio as a cross-check). The historical counts, 107,851 production and
201,551 staging, imply a provisional row factor of 0.535, not a measured build
estimate. Refresh counts and storage characteristics; do not promise a duration.

## Out-of-band production build

Use a dedicated PostgreSQL session with autocommit enabled. Run each statement
separately; no transaction block or multi-statement execution request. Proposed
session budgets below need Griff's approval; they do not change application or
authenticator settings:

```sql
SET lock_timeout = '5s';
SET statement_timeout = '30min';
CREATE INDEX CONCURRENTLY IF NOT EXISTS picks_updated_at_idx ON public.picks (updated_at);
```

CIC takes SHARE UPDATE EXCLUSIVE, permits ordinary writes, scans twice and may wait
for older transactions/snapshots. It cannot run inside a transaction block. Monitor
`pg_stat_progress_create_index`, `pg_stat_activity`, locks, disk, elapsed duration
and application errors. Cancellation/timeout requires catalog inspection.

```sql
SELECT idx.relname, i.indrelid::regclass AS indexed_table, am.amname,
       i.indisvalid, i.indisready, i.indislive, i.indisunique,
       i.indnkeyatts, i.indnatts,
       pg_get_expr(i.indpred, i.indrelid) AS predicate,
       pg_get_expr(i.indexprs, i.indrelid) AS expressions,
       pg_get_indexdef(i.indexrelid) AS definition,
       pg_relation_size(i.indexrelid) AS bytes
FROM pg_index i
JOIN pg_class idx ON idx.oid = i.indexrelid
JOIN pg_am am ON am.oid = idx.relam
WHERE idx.oid = to_regclass('public.picks_updated_at_idx');
```

Require one valid, ready, live, nonunique btree on `public.picks(updated_at)` with
one key, no included columns, predicate or expression. Save size and build duration.

## Staging and post-apply verification

Operating Claude owns staging apply under PM authorization with `ci.yml` idle.
Capture before/after plans and timings for these two guard statements using the
exact DB-text watermark and last-created timestamp from a real guard run:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT updated_at FROM public.picks ORDER BY updated_at DESC LIMIT 1;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT count(*) FROM public.picks
WHERE updated_at > :'watermark'::timestamptz
  AND created_at <= :'last_created_at'::timestamptz;
```

Expected plans are an Index Only Scan Backward for the watermark and an index
range scan for check 2, with `created_at` as a residual filter. Record actual plans,
rows, buffers and times; do not force planner choices. Compare the first PR CI
under-load sample to a later lane CI run after the authorized staging apply.
Measure insert/update costs before/after with pg*stat_statements deltas or a bounded
probe, HOT ratio (`n_tup_hot_upd/n_tup_upd`), index count and size. Every update to
updated_at incurs index maintenance and can prevent HOT updates. The index does
not prove slow phases end: existing indexed readers reached 7.7–7.8 seconds.
Record unmeasured figures as not proven. Existing staging-only indexes are out of
scope: `picks_staging*\*`, `picks_open_states_created_idx`,
`picks_track_only_validated_created_idx`.

After production catalog and both EXPLAIN checks succeed, run the approved
`supabase db push` against the explicitly verified production project using the
pinned CLI's documented target options. The repo migration first validates the
out-of-band index, then its ordinary `CREATE INDEX IF NOT EXISTS` is a validated
no-op and the ledger records the migration. Do not assume CLI transaction behavior.
Require Production Post-Migration Verification and Live Schema Parity PASS.

Order: governed merge → separately authorized Griff production apply → guarded
ledger apply → post-migration verification and parity PASS → governed lane close.
Pre-merge parity failure is `PENDING_POST_DEPLOY`, never a lane-close PASS.

## Failure recovery and rollback

If a failed build leaves an INVALID index, verify its identity and that no build
is active, then with explicit authorization run standalone in autocommit:

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.picks_updated_at_idx;
```

Reinspect absence and resolve the failure before an authorized retry. The same
concurrent statement is the production rollback; capture absence and application
health and reconcile the ledger through the governed process. Dropping the index
restores scan/timeout exposure without changing pick data. The repository down
script uses ordinary `DROP INDEX IF EXISTS` for scratch migration round trips;
it is not the production concurrent rollback command.

References: [PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html),
[PostgreSQL pg_index](https://www.postgresql.org/docs/current/catalog-pg-index.html).
