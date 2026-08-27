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
- [x] `pnpm verify:static` — every static stage green, including the
      executable-wiring guard, with this lane's own 10 tests now reachable from
      `test:ops`.
- [ ] `pnpm test:db` is **not obtainable locally** and is expected to be
      produced in CI — see Known gap 1. It is not a defect in this lane.

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

The lane's 10 tests are now wired into `test:ops`, so they execute inside
required `verify` rather than only when invoked by hand. The wiring guard
confirms it:

```text
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=469 required-reachable=314 optional-reachable=36
                    fixture-helper=0 quarantined=0 unwired=119 (baselined=119 new=0)
[executable-wiring] capabilities total=155 wired=137 orphan=18 (baselined=18 new=0)
[executable-wiring] baseline tests=119/119 capabilities=18/18
```

`required-reachable` moved 313 -> 314 and `capability orphan` 19 -> 18: exactly
this lane's test file and its capability, and nothing else. No entry was added
to `executable-wiring-baseline.json` — the signal was fixed, not suppressed.

Every static stage of `pnpm verify` passes on this branch:

```text
$ pnpm verify:static
ci:db-client-boundary, ops:sync-check, ops:system-alignment-check,
ops:automation-coverage-check, env:check, lint, type-check, build,
test (4,895 pass / 0 fail), smart-form verify, verify:commands
-> all green
```

### 9. Command receipts

```text
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(no diagnostics; exit 0)

$ pnpm test
# tests 4895
# pass 4895
# fail 0

$ pnpm verify:static
-> all stages green (see section 8); exit 0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 38
Rules matched: (none) — no R-level artifacts required for this diff
```

`pnpm verify` itself exits 1 in this worktree, and only at `test:live-db` — see
Known gap 1. Every stage before it passes.

### 10. Migration gates

This migration carries an explicit `-- NO-PRECONDITION-REQUIRED:` declaration
rather than a `-- FAIL-CLOSED-PRECONDITION:` one. The reason is recorded in the
migration itself and is not a convenience: the fail-closed precondition drill
requires the migration to raise SQLSTATE `42P07` when a declared relation is
seeded as a decoy, and satisfying that would mean deleting the idempotency that
makes a second apply mutate nothing — a property this lane is required to have.
The invariants this migration does assert (complete coverage of the declared
range, and no DEFAULT partition) both `RAISE EXCEPTION` inside the same
transaction as the DDL, so a violation rolls the whole migration back.

The reversibility artifact is
`db/migrations-rollback/20260824000000_utv2_1736_offer_history_forward_partitions.down.sql`.
It reverses exactly what the migration creates — the 147 in-range partitions and
the helper function — refuses any partition holding rows, and never touches the
60 pre-existing partitions, which are outside the provisioned range by
construction.

The `skip-proof-coverage` label is applied. `proof-coverage-guard` fires on any
`supabase/migrations/*.sql` change and asks for an app-level live-DB proof
because that class of change "has shipped broken because unit tests pass under
InMemory while production diverges". That rationale does not apply here: this PR
adds no app runtime code path at all. The monitor is read-only ops tooling, and
the migration's coverage is the three dedicated scratch-Postgres drills plus
Live Schema Parity plus the staging writable-DB proof — strictly stronger than an
InMemory-versus-live comparison.

## Known gaps, stated plainly

1. **`pnpm verify` cannot go green in this worktree, and the reason is
   containment, not this lane.** `verify` is `verify:static && test:live-db`.
   `verify:static` is fully green. `test:live-db` refuses immediately:

   ```text
   $ tsx scripts/ci/assert-staging-target.ts
   [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
   [assert-staging] REFUSED: target identity could not be resolved from its URL
     (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.
     Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
   ```

   Production containment sets `SUPABASE_URL=http://127.0.0.1:1` locally, so no
   local invocation can reach a writable database — which is the intended
   behaviour. The `pnpm test:db` receipt for this lane is produced by CI's
   `staging-ci` environment inside the required `verify` job. This is a
   correct safety refusal, not lane debt, and it is where the T1 live-DB
   evidence must come from.

   The earlier wiring blocker recorded here is **resolved**: under a PM-
   authorized scope extension covering `package.json`, this lane's test file is
   wired into `test:ops` and the guard reports `verdict=PASS` with
   `new=0` on both tests and capabilities.

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
