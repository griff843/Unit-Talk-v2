# PROOF: WORK-2026092313

MERGE_SHA: aa4c5840001ebeda732f475979481b7756f0fce5

Generated at: 2026-09-23T22:19:30.000Z
Issue: WORK-2026092313
Tier: T2
Lane type: governance
Branch: claude/work-2026092313-tripwire-partition-size
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1641
Head SHA: 1715e1c0347c3de75500f69311b58f116bc42a63
Execution SHA: 1715e1c0347c3de75500f69311b58f116bc42a63
Diff base: 7159bcdeb2141b4b620f3335122df63fa0d39721
result: pass

## ASSERTIONS:

- [x] The `table_size` check in `scripts/ops/db-health-tripwire.ts` sized each hot table with
      `pg_total_relation_size(relid)` from `pg_stat_user_tables`. For the partitioned
      `provider_offer_history` that is 0. Run 35918291130 (2026-09-23) printed
      `provider_offer_history | 0 MB | 300 MB | env | PASS`.
- [x] `TABLE_SIZE_SQL` (`scripts/ops/db-health-checks.ts`) sums `pg_relation_size` and
      `pg_total_relation_size` over each table plus every member of its `pg_partition_tree`.
      A plain table's tree is empty, so plain tables measure exactly as before.
- [x] The tripwire executes `TABLE_SIZE_SQL` itself (`tx.unsafe<SizeRow[]>(TABLE_SIZE_SQL)`).
      The tested text is the executed text.
- [x] The table list is interpolated only from the closed `HOT_TABLES` constant, and each name is
      checked against a plain-identifier pattern.
- [x] The size check still runs inside the read-only transaction; the query is a pure catalog read.
- [x] No threshold, severity rule or other check is changed.

## EVIDENCE:

### 1. The exact constant, executed read-only against production (2026-09-23)

The text printed by `TABLE_SIZE_SQL` was executed through the read-only Supabase SQL tool on
`zfzdnfwdarxucxtaojxm`. The pre-fix query was run alongside it:

| table | pre-fix total_bytes | TABLE_SIZE_SQL total_bytes |
|---|---|---|
| game_results | 58318848 | 58318848 |
| odds_snapshots | 447963136 | 447963136 |
| raw_payloads | 727441408 | 727441408 |
| system_runs | 1376960512 | 1376960512 |
| provider_offer_history | 0 | 8499781632 |

### 2. Mutation drill

Each mutation was applied alone and the file restored from a copy before the next.

```
== M1 partition-tree branch replaced by the relation itself
not ok 52 - WORK-2026092313: the size query sums each table with its partition tree
== M2 the relation itself dropped from the set
not ok 52 - WORK-2026092313: the size query sums each table with its partition tree
== M3 relkind limited to 'r' (partitioned parents excluded)
not ok 52 - WORK-2026092313: the size query sums each table with its partition tree
== M4 tripwire reverted to its own pg_stat_user_tables query
not ok 54 - WORK-2026092313: the tripwire executes the tested size query, not its own
== restored
# tests 70
# pass 70
# fail 0
```

### 3. Tests

```
$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
# tests 70
# pass 70
# fail 0

$ pnpm test
pass 6847, fail 0
```

### R-level

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head 1715e1c0347c3de75500f69311b58f116bc42a63
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm exec eslint` on the 3 changed files: exit 0
- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts`: 70 pass, 0 fail
- [x] `pnpm test`: 6847 pass, 0 fail
- [x] `ops:preflight`: PASS, 38 checks
- [x] Mutation drill: each of the 4 mutations turns a named test red
- [ ] `pnpm verify`: cannot exit 0 from a containment-isolated checkout. CI runs `verify` on the PR.

## Runtime Verification

The runtime evidence is section 1: the exact query text, executed read-only against production.
The next scheduled `db-health-tripwire.yml` run is where the change becomes observable.
`provider_offer_history` should then report about 8.1 GB and trip `table_size` as critical.
`db_tripwires` was already red and stays red. No dimension can move toward pass.

## Merge SHA Binding

Merge SHA: aa4c5840001ebeda732f475979481b7756f0fce5
PR: https://github.com/griff843/Unit-Talk-v2/pull/1641
Execution SHA: 1715e1c0347c3de75500f69311b58f116bc42a63

### Re-anchor to `1715e1c0347c3de75500f69311b58f116bc42a63`

Branch refreshed from origin/main `353274ae6` after main advanced. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092308.yml`, `.ops/sync/WORK-2026092311.yml`, `.ops/sync/WORK-2026092312.yml`, `.ops/sync/WORK-2026092314.yml`, `.ops/sync/WORK-2026092405.yml`, `apps/api/src/model-performance-service.test.ts`, `apps/api/src/model-performance-service.ts`, `apps/api/src/t1-proof-utv2-1137-settlement-corrections.test.ts`, `docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md`, `docs/05_operations/SGO_REACTIVATION_GATE.md`, `docs/05_operations/WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md`, `docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`, `docs/06_status/lanes/WORK-2026092308.json`, `docs/06_status/lanes/WORK-2026092311.json`, `docs/06_status/lanes/WORK-2026092312.json`, `docs/06_status/lanes/WORK-2026092314.json`, `docs/06_status/lanes/WORK-2026092405.json`, `docs/06_status/proof/WORK-2026092308/evidence.json`, `docs/06_status/proof/WORK-2026092308/verification.md`, `docs/06_status/proof/WORK-2026092311/diff-summary.md`, `docs/06_status/proof/WORK-2026092311/verification.md`, `docs/06_status/proof/WORK-2026092312/.gitkeep`, `docs/06_status/proof/WORK-2026092312/diff-summary.md`, `docs/06_status/proof/WORK-2026092312/verification.md`, `docs/06_status/proof/WORK-2026092314/diff-summary.md`, `docs/06_status/proof/WORK-2026092314/verification.md`, `docs/06_status/proof/WORK-2026092405/diff-summary.md`, `docs/06_status/proof/WORK-2026092405/verification.md`, `docs/06_status/proof/WORK-2026092405/work-order.md`, `docs/06_status/readiness/readiness-score.json`, `docs/mission/plan.md`, `scripts/ops/readiness-refresh.test.ts`, `scripts/ops/readiness-refresh.ts`, `scripts/warehouse/conveyor.test.ts`, `scripts/warehouse/query.test.ts`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `cf91c44c53a986b1a6ec3cea845da922d1afa592`. `verify` re-runs on the new head.
