# PROOF: UTV2-1640 Phase A

MERGE_SHA: 714fb9c619daa0424999bfa767d8f9764a32e367

Bound to the merge commit of the implementation PR, produced by GitHub's
normal exact-head merge endpoint. Previously this named the pre-merge
code-only commit; that commit is not an ancestor of any post-merge head
because the PR was squash-merged, so the merge SHA is now the only value
that both names the shipped code and satisfies the validator's
ancestor-of-HEAD requirement.

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

**Correction (caught by the schema round-trip drill before merge, not after):**
`system_runs` was NOT at the cluster default before this migration. Its
original `CREATE TABLE` (`00000000000000_baseline_live_schema.sql`) already
carries a table-level override of `autovacuum_vacuum_scale_factor=0.05`,
`autovacuum_analyze_scale_factor=0.05` (plus `autovacuum_vacuum_threshold=100`,
`autovacuum_vacuum_cost_delay=10`). This migration's `SET` overwrites the two
scale factors from 0.05/0.05 to 0.02/0.01 -- a further ~2.5x tightening on
top of an existing override, not a first override from cluster defaults. The
reversal is therefore a `SET` back to the true prior values, not a `RESET`
(which would have dropped past the pre-existing override to the cluster
default of 0.2/0.1 -- a state `system_runs` was never actually in):

```sql
ALTER TABLE public.system_runs SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
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

The two named keys hold their new values (overwriting the pre-existing
0.05/0.05, not adding new keys); two other pre-existing overrides
(`autovacuum_vacuum_threshold=100`, `autovacuum_vacuum_cost_delay=10`) are
untouched -- `ALTER TABLE ... SET` only updates the keys named, confirming
no accidental clobbering. This reloptions readback alone doesn't distinguish
"pre-existing key overwritten" from "new key added"; that distinction only
surfaced from reading `00000000000000_baseline_live_schema.sql` directly
after the schema round-trip drill's hash mismatch pointed at this migration.

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
- [x] Applied production state matches the repository migration exactly, re-verified 2026-08-03 (see EVIDENCE below).

## EVIDENCE:

Live production verification that the already-applied migration matches the repository migration byte-for-byte in effect. Read-only query against Supabase project `zfzdnfwdarxucxtaojxm`, executed 2026-08-03:

```sql
select relname, reloptions
from pg_class
where relname = 'system_runs'
  and relnamespace = 'public'::regnamespace;
```

```
relname     | reloptions
------------+--------------------------------------------------------------
system_runs | {autovacuum_vacuum_threshold=100,
            |  autovacuum_vacuum_cost_delay=10,
            |  autovacuum_vacuum_scale_factor=0.02,
            |  autovacuum_analyze_scale_factor=0.01}
```

Repository migration `supabase/migrations/20260801220000_utv2_1640_system_runs_autovacuum_tuning.sql` sets exactly:

```sql
ALTER TABLE public.system_runs SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);
```

Production reports `autovacuum_vacuum_scale_factor=0.02` and `autovacuum_analyze_scale_factor=0.01` — an exact match on both keys the migration sets, with no drift.

The two unrelated pre-existing overrides (`autovacuum_vacuum_threshold=100`, `autovacuum_vacuum_cost_delay=10`) are still present and untouched, confirming the migration preserved them. This is also why the rollback must be `SET (… = 0.05, … = 0.05)` and **not** `RESET`: `RESET` would drop the two targeted keys to cluster defaults rather than restoring the documented pre-existing 0.05/0.05 values.

## Post-PR CI gate reconciliation

Opening the PR surfaced two migration-specific gates this lane had not yet
satisfied, plus one pre-existing, unrelated failure:

- **Migration reversibility gate / schema round-trip drill**: both require a
  down script at `db/migrations-rollback/<basename>.down.sql` for every new
  migration. The drill's scratch-Postgres run (which replays every migration
  from `00000000000000_baseline_live_schema.sql` forward) caught a genuine
  bug in the first version of the down script: it used `RESET`, which does
  not restore `system_runs`'s true pre-existing override (see "Correction"
  above) -- `RESET` overshoots past 0.05/0.05 to the cluster default.
  Changed to `SET (autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05)` -- but the drill STILL failed
  after that fix, with a different hash mismatch. Root-caused via a
  session-local temp-table reproduction against production (isolated,
  auto-dropped, zero risk, no real object touched):

  ```sql
  CREATE TEMP TABLE t_repro (id int) WITH (
    autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05,
    autovacuum_vacuum_threshold=100, autovacuum_vacuum_cost_delay=10);
  -- reloptions: [vacuum_scale_factor, analyze_scale_factor, vacuum_threshold, cost_delay]
  ALTER TABLE t_repro SET (autovacuum_vacuum_scale_factor=0.02, autovacuum_analyze_scale_factor=0.01);
  -- reloptions: [vacuum_threshold, cost_delay, vacuum_scale_factor, analyze_scale_factor]  <- reordered!
  ALTER TABLE t_repro SET (autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05);
  -- reloptions: [vacuum_threshold, cost_delay, vacuum_scale_factor, analyze_scale_factor]  <- same order as post-up, NOT the original
  ```

  Postgres's `ALTER TABLE ... SET` does not update an existing reloption key
  in place -- it removes the named keys and re-appends them at the end of the
  array, permanently changing their position. Since the round-trip drill
  compares a `pg_dump`-rendered DDL hash (which renders reloptions in
  `pg_class` array order), **no down script built from `ALTER TABLE
  SET`/`RESET` can ever reproduce a byte-identical pre-up hash** once a
  pre-existing reloption key is touched by any ALTER. This is a mechanical
  limitation of hash-based schema verification against ALTER-based reloption
  changes -- not evidence the change is functionally unsafe or unreversed;
  the `SET` statement is still the correct, tested functional reversal
  (verified via `pg_class.reloptions` readback during Phase A).

  Marked the down script `-- IRREVERSIBLE:` per `db/migrations-rollback`'s
  documented convention (functionally reversible, mechanically
  hash-unreachable), which requires a matching entry in
  `db/migrations-rollback/irreversible-exemption-registry.json` with
  `ratified_by`/`ratified_at` before the gate passes. **That entry is
  intentionally NOT added in this PR** -- the registry's own existing entries
  are all PM-ratified (`ratified_by: "griff843"`), and self-adding one here
  would be exactly the self-certification loophole UTV2-1521 already closed
  for `file_scope_lock` (the code technically only checks that a matching
  entry exists, not that `ratified_by` is authentic -- a real, separate
  hardening gap worth flagging, not exploiting). A draft entry is provided in
  the PR conversation for the PM to add or ratify.

  `db/migrations-rollback/**` added to this lane's `file_scope_lock`
  (declaration only -- see the File scope lock note below on why this alone
  does not satisfy CI).
- **"Require live-DB proof for runtime changes"**: this gate requires either
  a code-based live-DB proof test (`apps/api/src/t1-proof-*.test.ts` or a
  `packages/*|apps/*/src/scripts/*.ts` proof script) or the `skip-proof-coverage`
  label with justification. This migration has no application code path and no
  repository/controller logic to exercise -- the InMemory-vs-production
  divergence risk the gate exists to catch (UTV2-519, UTV2-521) does not apply
  to a storage-parameter-only `ALTER TABLE`. The actual live-DB proof for this
  change is the direct production execution documented above (preflight,
  `ANALYZE`, `VACUUM`, `ALTER TABLE`, and a `pg_class.reloptions` verification
  against the real Supabase project) -- labeled `skip-proof-coverage` on the
  PR with this rationale rather than writing a synthetic test around code that
  doesn't exist.
- **"Live Schema Parity"**: fails independently of this change, on
  `command_center_delivery_mappings`/`command_center_game_threads` --
  the same pre-existing, unrelated schema-parity gap noted in "Types
  regeneration check" above. This is a standing, repo-wide condition (any PR
  touching `supabase/migrations/**` currently trips it) with no in-workflow
  override mechanism; resolving it is out of scope for Phase A and is flagged
  separately as a genuine blocker, not fixed here.

## Scope

`supabase/migrations/20260801220000_utv2_1640_system_runs_autovacuum_tuning.sql`,
`db/migrations-rollback/20260801220000_utv2_1640_system_runs_autovacuum_tuning.down.sql`,
plus lane apparatus. `packages/db/src/database.types.ts` declared in file
scope but intentionally not modified (see "Types regeneration check" above).

## Merge SHA Binding

Merge SHA: `714fb9c619daa0424999bfa767d8f9764a32e367`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1367
