# PROOF: UTV2-1736

MERGE_SHA: cbfc0ebe775489a44bbe168004f41ec6a8decca4

Continuous daily partition coverage for `public.provider_offer_history`, plus a
read-only forward-coverage monitor that raises a pre-expiry alert into the real
operations sinks.

**No production DDL was applied.** Every DDL scenario below was executed against
the non-production staging project `xskgrzbteyqdufktjrjx`.

## Production truth that motivates this lane

Read from production `zfzdnfwdarxucxtaojxm` on 2026-08-26 (read-only `SELECT`):

```text
existing_partitions : 60
earliest            : 2026-05-02
latest              : 2026-06-30
target_range_days   : 147   (2026-07-01 .. 2026-11-24)
missing_in_range    : 147
missing_up_to_today :  58
default_partitions  :   0
```

There is no partition covering any date on or after 2026-07-01 and there is no
DEFAULT partition. `provider_offer_history` has therefore been **fail-closed to
every insert for 57 days**. This lane restores continuous coverage from
2026-07-01 through 2026-11-24 — the 58 elapsed days plus 89 forward days.

### Context recorded, not remediated

`pg_cron` job 5 (`0 3 * * *`, active) has **never once succeeded**:

```text
jobid | schedule  | active | runs | succeeded | failed | first_run            | last_run
------+-----------+--------+------+-----------+--------+----------------------+---------------------
    5 | 0 3 * * * | t      |  109 |         0 |    109 | 2026-05-10 03:00:00Z | 2026-08-26 03:00:00Z
```

Retention has consequently never run, which is why 60 partitions survive a
nominal 7-day policy. Provisioning forward without containing job 5 converts a
fail-closed error into unbounded growth. Job 5 is **not touched by this lane** —
it is Successor A, and it requires its own production decision. No partition
drop, detach, pruning, retention activation, or audit-log mutation is performed
or enabled here.

## Verification

ASSERTIONS:

- [x] The migration provisions every day from 2026-07-01 through 2026-11-24
      (147 partitions) using the lean three-index shape matching current
      production. The six additional legacy indexes are deliberately **not**
      restored in this lane.
- [x] No DEFAULT partition is created, and the migration asserts none exists —
      out-of-range inserts must keep failing closed rather than silently landing
      in a catch-all.
- [x] The migration is idempotent: a second apply creates nothing and replaces
      no relation.
- [x] Rollback removes only the partitions this migration provisions, and only
      while they are empty.
- [x] Rollback refuses a non-empty partition rather than destroying data.
- [x] Reapply after rollback restores full coverage and preserves the data that
      caused the refusal.
- [x] An induced pre-expiry condition reaches the **real operations sinks** —
      `system_runs` and `audit_log` — not merely the predicate.
- [x] `pnpm test` on the lane branch: 4,895 tests, 0 failures, exit 0.
- [ ] `pnpm verify` **FAILS** on this branch — see Known gap 1. The failure is
      the executable-wiring guard correctly reporting that this lane's own test
      file is not reachable from any package script or workflow command.

## Runtime Verification

All DDL executed against staging `xskgrzbteyqdufktjrjx`. Production was read
only.

EVIDENCE:

### 1. Clean apply

```text
SELECT count(*) AS partitions, min(day) AS earliest, max(day) AS latest ...

partitions | earliest   | latest
-----------+------------+------------
       147 | 2026-07-01 | 2026-11-24
```

### 2. Second apply mutates nothing

The provisioning block was executed a second time against the already-populated
schema, capturing partition OIDs before and after:

```text
NOTICE:  second apply created 0 partition(s)

before_count | after_count | oids_replaced
-------------+-------------+--------------
         147 |         147 |             0
```

`oids_replaced = 0` is the decisive value: no partition was dropped and
recreated behind an unchanged count.

### 3. Row routing

```text
INSERT INTO public.provider_offer_history
  (provider_key, provider_event_id, provider_market_key, devig_mode,
   snapshot_at, idempotency_key)
VALUES ('utv2-1736-proof','evt-proof-1','mkt-proof-1','PAIRED',
        TIMESTAMPTZ '2026-07-01 12:00:00+00','utv2-1736-rollback-proof-1');

landed_in                         | rows
----------------------------------+-----
provider_offer_history_p20260701  |    1
```

### 4. Rollback removes only empty lane-created partitions, and 5. refuses a non-empty one

The rollback block from the migration was executed verbatim over the full range
while `p20260701` held the row above:

```text
NOTICE:  REFUSED: provider_offer_history_p20260701 holds 1 row(s); leaving attached
NOTICE:  rollback: dropped=146 refused=1

partitions_remaining | nonempty_partition_survived
---------------------+----------------------------
                   1 | t
```

146 empty partitions were detached and dropped; the single occupied partition
was refused and remained attached with its row intact. The rollback never
touched a partition outside the 2026-07-01..2026-11-24 range it provisions — the
60 pre-existing production-shaped partitions are outside that range by
construction.

### 6. Reapply after rollback succeeds

```text
NOTICE:  reapply created 146 partition(s)

partitions_after_reapply | preserved_rows | default_partitions
-------------------------+----------------+-------------------
                     147 |              1 |                  0
```

Coverage restored, the refused partition's row preserved, and still no DEFAULT
partition.

### 7. Induced pre-expiry reaches the real operations sink

`runPartitionCoverageCheck` was driven with a coverage report leaving 10 forward
days against thresholds `warn<=30, critical<=14`. Both real sinks carry the
result:

```text
-- system_runs
sink        | kind                    | status | at
------------+-------------------------+--------+------------------------------
system_runs | ops.partition_coverage  | failed | 2026-08-27 01:32:32.730397+00

details: {"level":"CRITICAL","today":"2026-08-27","parent":"provider_offer_history",
 "message":"provider_offer_history forward coverage CRITICAL: only 10 day(s) remaining
 (covered through 2026-09-05; warn<=30, critical<=14). There is no DEFAULT partition,
 so ingestion fails closed once coverage runs out.",
 "issue_id":"UTV2-1736","thresholds":{"warnDays":30,"criticalDays":14},
 "total_partitions":67,"covered_through_day":"2026-09-05","forward_days_remaining":10}
```

```text
-- audit_log
entity_type        | entity_ref             | action                      | actor
-------------------+------------------------+-----------------------------+-------------------------------
partition_coverage | provider_offer_history | partition_coverage.critical | UTV2-1736:partition-provisioner
```

The run is recorded `failed`, not `succeeded`, so the alert is visible to
anything that reads run status rather than only to a log scraper.

The staging fixture row and its `sportsbooks` fixture were deleted after the
scenarios completed; staging carries no residue from this proof.

### 8. Static verification

```text
$ pnpm test
# tests 4895
# pass 4895
# fail 0
# cancelled 0
# skipped 0
```

```text
$ pnpm exec tsx --test scripts/ops/partition-provisioner.test.ts
1..10
# tests 10
# pass 10
# fail 0
```

## Known gaps, stated plainly

1. **BLOCKER — `pnpm verify` fails: this lane's own test file is not wired into
   any executable command.** `test:ops` in `package.json` is a hardcoded file
   list, not a glob, and `scripts/ops/partition-provisioner.test.ts` is absent
   from it. The repo enforces this mechanically, and the guard is red:

   ```text
   [executable-wiring] verdict=FAIL required_roots=verify
   [executable-wiring] tests total=469 required-reachable=313 optional-reachable=36
                       unwired=120 (baselined=119 new=1)
   [FAIL] WIRING_TEST_UNWIRED_NEW scripts/ops/partition-provisioner.test.ts
          - test file is not reachable from any package script or workflow command
   [FAIL] WIRING_CAPABILITY_ORPHAN scripts/ops/partition-provisioner.ts
          - active capability has documentation-only references and no executable reference
   $ pnpm verify → EXIT=1
   ```

   The 4,895-test figure above therefore does **not** include this lane's own 10
   tests, which run only when invoked directly.

   There are exactly two remedies and **both are outside this lane's immutable
   `file_scope_lock`**:
   - wire the test into `test:ops` in `package.json` (the correct fix — it makes
     the tests actually run), or
   - add a reviewed disposition to
     `docs/05_operations/executable-wiring-baseline.json` (suppresses the signal
     rather than fixing it; not recommended).

   This lane cannot go green without a PM scope extension. It is a governance
   scope decision, not something the lane may self-approve.

2. **The lane branch is 23 commits behind `origin/main` and cannot be synced
   through the sanctioned path.** `ops:merge-wrapper git-merge-main` — the verb
   the wrapper itself recommends for "any branch carrying governance artifacts
   or a proof bundle" — is implemented as `git merge --ff-only origin/main`
   (`scripts/ops/ops-merge-wrapper.ts:96`), which by definition cannot merge a
   diverged branch. The only working alternative, `git-rebase-main`, rewrites
   history and invalidates pm-verdict, `t1-approved` evidence, and
   executor-result. Raw `git merge` is forbidden. This is governance tooling
   debt, not a safety refusal, and it blocks closeout rather than PR open.

3. **The real-sink proof was executed by driving the real function's output into
   staging's real `system_runs` and `audit_log`**, because staging service-role
   credentials are not available locally under production containment. Closing
   the last gap — an automated in-CI integration test — would require editing
   `package.json` and adding a live T1 proof file, both outside `file_scope_lock`.

## Scope

No production DDL. No partition drop, detach, pruning, retention activation, or
audit-log mutation. No SGO, ingestion restart, worker start, queue replay,
delivery activation, system picks, or member-facing output. The monitor is
read-only and issues no DDL.
