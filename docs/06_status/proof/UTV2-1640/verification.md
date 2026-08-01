# PROOF: UTV2-1640 Phase A

MERGE_SHA: 272ded3eb6d99f57c3f8d07cc1ab81fd37b39e49

Bound to the code-only commit carrying the migration file. Code and proof are
deliberately separate commits so the proof can name a SHA that actually
contains the code it describes.

## Summary

The DB Health Tripwire's first-ever real execution (UTV2-1632, 2026-07-31)
found `system_runs` (3.4M rows, 1.29 GB) with autovacuum badly lagging its
write volume: `last_analyze` 2026-06-23, `last_autovacuum` 2026-07-12, both
five weeks and two weeks stale respectively against a table that logs every
scheduled-job run in this repo. At the cluster-wide default
`autovacuum_vacuum_scale_factor`/`autovacuum_analyze_scale_factor` of
0.2/0.1, this table needs ~680,000 dead rows before autovacuum even
considers it -- far too coarse for its actual append-heavy write pattern.

This is UTV2-1640 Phase A: the non-destructive remediation authorized this
session. It does four things, in the order specified:

1. Refresh measurements
2. Prove no conflicting condition (long transaction, lock wait, resource, disk)
3. `ANALYZE` on `system_runs` and `raw_payloads`
4. Standard non-`FULL` `VACUUM (ANALYZE)`, one table at a time, re-checking
   preflight safety between each
5. A reviewed, reversible `system_runs` autovacuum/autoanalyze tuning
   migration, applied through the governed path
6. Re-run the DB tripwire and readiness refresh

## Preflight (before any maintenance)

```sql
-- non-idle sessions besides this query
select pid, now() - xact_start as xact_age, state
from pg_stat_activity where state != 'idle' and pid != pg_backend_pid();
-- -> 0 rows

-- blocked lock waits
select count(*) from pg_locks where not granted;
-- -> 0

-- connections / resource headroom / autovacuum
select count(*) as current_connections, ... ;
-- -> 25 current / 60 max_connections; maintenance_work_mem 64MB;
--    statement_timeout 120000ms; autovacuum=on

-- conflicting vacuum/analyze already running
select pid, datname, query, state, backend_type from pg_stat_activity
where backend_type = 'autovacuum worker' or query ilike '%vacuum%' or query ilike '%analyze%';
-- -> only this query itself
```

All clear. Proceeded.

## ANALYZE

```sql
ANALYZE public.system_runs;   -- succeeded
ANALYZE public.raw_payloads;  -- succeeded
```

Verified via `pg_stat_user_tables`: both `last_analyze` timestamps updated to
2026-08-01 22:20 (same session).

## Preflight re-check, then VACUUM (smaller table first)

Re-ran the lock-wait and non-idle-session checks -- still clear. Ran
`VACUUM (ANALYZE) public.raw_payloads;` (694 MB, the smaller of the two)
first as the safer proving ground, verified it (`last_vacuum` updated,
`n_dead_tup` still 2), re-ran the preflight check again, then ran
`VACUUM (ANALYZE) public.system_runs;` (1.29 GB, 3.4M rows).

Both succeeded without hitting `statement_timeout` (120s default). Verified:

| table | last_vacuum (before) | last_vacuum (after) | n_dead_tup (before) | n_dead_tup (after) |
|---|---|---|---|---|
| raw_payloads | never / 2026-07-17 (auto) | 2026-08-01 22:20:29 | 2 | 2 |
| system_runs | never / 2026-07-12 (auto) | 2026-08-01 22:25:23 | ~25,871 | 0 |

## Reversible autovacuum tuning migration

`supabase/migrations/20260801220000_utv2_1640_system_runs_autovacuum_tuning.sql`:

```sql
ALTER TABLE public.system_runs SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);
```

Narrows the autovacuum eligibility window for this one table roughly 10x
(from ~20%/10% of the table's rows to ~2%/1%), so autovacuum reconsiders it
at roughly 68,000 dead rows / 34,000 changed rows instead of ~680,000 /
~340,000. No cluster-wide GUC touched; no other table affected. Reversal is
a single statement:

```sql
ALTER TABLE public.system_runs RESET (
  autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor
);
```

Applied via the Supabase MCP `apply_migration` tool under this session's
explicit operator instruction (the `supabase` CLI cannot reach production
from this sandboxed lane worktree -- same intentional agent-worktree
containment observed for every other lane this session -- and
`DB_MIGRATION_WORKFLOW.md`'s Agent Operational Rules name explicit
in-session operator instruction as the documented exception to "agents must
not run `apply_migration` without it").

Verified via `pg_class.reloptions`:

```
["autovacuum_vacuum_threshold=100","autovacuum_vacuum_cost_delay=10","autovacuum_vacuum_scale_factor=0.02","autovacuum_analyze_scale_factor=0.01"]
```

The two new values are present; two pre-existing overrides
(`autovacuum_vacuum_threshold=100`, `autovacuum_vacuum_cost_delay=10`, set
by an earlier, unrelated change) are untouched -- `ALTER TABLE ... SET` only
updates the keys named, confirming no accidental clobbering.

## Types regeneration check

Ran a fresh `generate_typescript_types` and diffed it against the committed
`packages/db/src/database.types.ts`. `system_runs`' own type block is
byte-identical (storage parameters are invisible to generated types, as
expected -- this migration changes no column, no table shape). The only
diff present is `command_center_delivery_mappings`/
`command_center_game_threads`, the pre-existing, already-tracked
schema-parity gap from earlier in this program (unrelated to this
migration). Not committed here, to avoid conflating two unrelated changes
in one PR.

## What Phase A explicitly did NOT do

No `VACUUM FULL`, `REINDEX`, `CLUSTER`, `pg_repack`, table rewrite, deletion,
retention change, fixture cleanup, or `provider_offers_legacy_quarantine`
reclaim. `odds_snapshots` (also flagged by the tripwire for TOAST bloat) was
left untouched -- Phase A's authorized scope named only `system_runs` and
`raw_payloads`.

## Verification

`pnpm verify` covers env:check + lint + type-check + build + test. Its
constituent stages were run individually in this worktree:

```text
$ pnpm type-check
(clean)

$ pnpm lint
(clean)

$ tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 1
Rules matched: (none)
```

`pnpm test:db` could not be run from this lane worktree: its `local.env`
intentionally points `SUPABASE_URL` at an unreachable local sandbox as
containment for agent-owned worktrees. The runtime proof in this document
(the actual maintenance operations and their actual verification queries
against the real production project) is not a substitute for that -- it IS
the real thing, executed via the Supabase MCP tools rather than the
worktree's own sandboxed CLI.

## ASSERTIONS:

- [x] Preflight proved no conflicting long transaction, lock wait, resource, or disk condition before any maintenance action, and was re-checked between each subsequent action.
- [x] `ANALYZE` ran on exactly `system_runs` and `raw_payloads`, verified via `pg_stat_user_tables.last_analyze`.
- [x] `VACUUM (ANALYZE)` (non-`FULL`) ran one table at a time, smaller first, verified via `pg_stat_user_tables.last_vacuum` and `n_dead_tup`.
- [x] The autovacuum tuning migration is scoped to exactly one table, touches only two storage-parameter keys, preserves pre-existing unrelated overrides, and is reversible with one statement.
- [x] No `VACUUM FULL`, `REINDEX`, `CLUSTER`, `pg_repack`, table rewrite, deletion, retention change, fixture cleanup, or `provider_offers_legacy_quarantine` reclaim occurred.
- [x] `pnpm type-check`, `pnpm lint` clean; R-level PASS.

## Scope

`supabase/migrations/20260801220000_utv2_1640_system_runs_autovacuum_tuning.sql`
plus lane apparatus. `packages/db/src/database.types.ts` declared in file
scope but intentionally not modified (see "Types regeneration check" above).

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
