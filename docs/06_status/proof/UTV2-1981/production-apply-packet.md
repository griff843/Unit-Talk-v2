# UTV2-1981 — production apply design

Status: design only; production execution is not authorized by this lane.
Obtain a separate Griff production authorization packet after staging evidence,
PM review, and governed merge. Do not execute live pre-merge DDL.

The keyset guard in `packages/db/src/runtime-repositories.ts` reads the newest
`updated_at` across all picks, then checks for rows with `updated_at > watermark`
and `created_at <= last_seen_created_at`. A single nonunique btree index supports
the watermark's backward scan and the change probe's updated_at range. The
created_at condition remains a residual filter. No status predicate is added:
departed members must remain visible. Runtime retry policy remains unchanged.

## Preconditions

1. Record approved issue, PR, merge SHA, operator, UTC time, and explicit target
   project identity; abort if identity is missing or differs from authorization.
   Staging proof must target `xskgrzbteyqdufktjrjx` using `staging-ci` and
   `CI_SUPABASE_*` credentials. Never print credentials.
2. Review migration history and schema drift. Check free disk, long transactions,
   and other index builds; a concurrent build scans twice and may wait for old
   transactions. Capture baseline query plans/timings before creating the index.
3. Inspect `public.picks_updated_at_idx` using the catalog query below. If the
   name exists, stop and compare definition/validity. A matching valid index is
   an existing effect to reconcile, not permission to blindly rerun. A failed
   build can leave an invalid index that must be explicitly cleaned up before
   retry. Do not hide this state with `IF NOT EXISTS`.
4. Confirm the approved runner sends the migration's single DDL statement in
   autocommit, without a surrounding transaction or a multi-statement request.
   Do not assume `supabase db push` or a SQL API meets this requirement. If the
   runner wraps transactions, use an authorized standalone PostgreSQL session
   and the governed migration-history reconciliation process after validation.
   Do not mark the migration applied before checking its effect.

## Apply and observe

Execute only the statement in
`supabase/migrations/20261107060000_utv2_1981_picks_updated_at_idx.sql`.
Use a dedicated DDL connection with an explicitly approved build timeout and
lock-wait budget; do not change the authenticator's 8-second timeout or global
settings. Record build duration and monitor `pg_stat_progress_create_index`,
`pg_stat_activity`, locks, disk, and application errors. Cancellation or timeout
requires catalog inspection; never retry blindly.

```sql
SELECT ns.nspname, idx.relname, am.amname,
       i.indisvalid, i.indisready, i.indislive,
       i.indisunique, i.indnkeyatts, i.indnatts,
       pg_get_expr(i.indpred, i.indrelid) AS predicate,
       pg_get_expr(i.indexprs, i.indrelid) AS expressions,
       pg_get_indexdef(i.indexrelid) AS definition,
       pg_size_pretty(pg_relation_size(i.indexrelid)) AS size
FROM pg_index i
JOIN pg_class idx ON idx.oid = i.indexrelid
JOIN pg_namespace ns ON ns.oid = idx.relnamespace
JOIN pg_am am ON am.oid = idx.relam
WHERE i.indrelid = 'public.picks'::regclass
  AND ns.nspname = 'public' AND idx.relname = 'picks_updated_at_idx';
```

Require exactly one valid, ready, live, nonunique btree on `(updated_at)`, without
a predicate or additional keys. Save the definition, size, and measured timing.

## Staging proof and acceptance

Capture before/after `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT updated_at FROM public.picks ORDER BY updated_at DESC LIMIT 1;
-- Bind the exact DB-text watermark and last row timestamp from a real guard run:
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT count(*) FROM public.picks
WHERE updated_at > :'watermark'::timestamptz
  AND created_at <= :'last_created_at'::timestamptz;
```

Use representative sparse/recent and broader change ranges, with normal planner
settings. Record index usage, rows, buffers, planning/execution time, and total
request time. A broad range may legitimately choose a sequential scan; do not
force `enable_seqscan=off` to manufacture performance proof. Execute the actual
multi-page guard through the application/PostgREST path with the normal 8-second
authenticator budget, not only a privileged SQL session. Require correct complete
results, both guard queries below the timeout, and no 57014 across recorded
repeated runs. Record fixture population and iteration count; empty-table proof
does not demonstrate the reported staging timeout is resolved.

Run `pnpm test:db` and the focused issue command from `.ops/work/UTV2-1981.md`.
Store measured plans, index validity, request timings and CI run/head identity in
the authorized proof bundle before requesting production execution. Current lane
contains design only; these measurements are deferred, not passed.

## Rollback and recovery

With explicit target/rollback authorization, execute
`db/migrations-rollback/20261107060000_utv2_1981_picks_updated_at_idx.down.sql`
as a standalone autocommit statement. The same command removes an invalid index
after a failed build, once its identity and lack of an active build are verified.
Capture catalog absence and application health. Dropping the index restores the
previous scan/timeout exposure; it does not change pick data. Reconcile migration
history through the governed deploy process before a future reapply.

PostgreSQL references: [CREATE INDEX and concurrent-build caveats](https://www.postgresql.org/docs/current/sql-createindex.html),
[DROP INDEX](https://www.postgresql.org/docs/current/sql-dropindex.html).
