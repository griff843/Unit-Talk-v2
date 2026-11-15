# PROOF: UTV2-1736

MERGE_SHA: b700091eb5b12605141b838297e3f04c1dcb121a

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
- [x] The `SECURITY DEFINER` helper function is callable only by `service_role`.
      `PUBLIC`, `anon`, and `authenticated` all hold no EXECUTE. Verified by
      reading `pg_proc.proacl` on staging, not by inference — see section 12.
- [x] The privilege assertion is **not vacuous**: re-granting EXECUTE to `anon`
      on staging made it raise its named error. See section 12.
- [x] `pnpm test` on the lane branch: 5,138 tests, 0 failures, exit 0.
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
# tests 5138
# pass 5138
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
test (5,138 pass / 0 fail), smart-form verify, verify:commands
-> all green
```

### 9. Command receipts

All re-executed at `b700091eb5b12605141b838297e3f04c1dcb121a`, after this branch
was rebased onto `origin/main` `e0bc1480`. The receipts captured before the
rebase are void and are not carried forward.

```text
$ pnpm type-check
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json
(no diagnostics; exit 0)

$ pnpm verify:static
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=469 required-reachable=314 optional-reachable=36 fixture-helper=0 quarantined=0 unwired=119 (baselined=119 new=0)
[executable-wiring] capabilities total=155 wired=137 orphan=18 (baselined=18 new=0)
[executable-wiring] baseline tests=119/119 capabilities=18/18
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 8 migration file(s) verified — no duplicate versions.
[lint-migrations] 7 migration file(s) checked — no findings.
VERIFYSTATIC_EXIT=0

$ pnpm test          # executed inside verify:static; aggregate across all suites
# tests 5138
# pass 5138
# fail 0
# skipped 0

$ pnpm exec tsx --test scripts/ops/partition-provisioner.test.ts
ok 1 - partitionNameForDay and dayFromPartitionName round-trip
ok 2 - computeCoverage counts only the unbroken forward run
ok 3 - a partition on the far side of a gap does not count as coverage
ok 4 - today uncovered means zero forward coverage
ok 5 - evaluatePreExpiry fires on exactly the thresholds it names
ok 6 - evaluatePreExpiry rejects an inverted threshold pair
ok 7 - an induced pre-expiry condition reaches the real operations sink
ok 8 - an OK condition still writes a receipt, and records the run as succeeded
ok 9 - sink failure propagates instead of being swallowed
ok 10 - buildProvisioningSql emits reversible, DEFAULT-free DDL and never executes
# tests 10
# pass 10
# fail 0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 14
Rules matched: (none) — no R-level artifacts required for this diff
```

**`Changed files: 14` overcounts; the lane's true delta is 12.** The checker
diffs two-dot (`origin/main..HEAD`), which includes commits `main` gained after
this branch diverged. The two extra files are both `main`'s, not this lane's:

```text
$ git diff origin/main...HEAD --name-only | wc -l    # three-dot: the lane's own commits
12
$ git diff origin/main..HEAD --name-only | wc -l     # two-dot: also sweeps in main's
14

only in the two-dot set:
  docs/06_status/lanes/UTV2-1512.json          <- from a67a6a59, the reconciler
  docs/06_status/readiness/readiness-score.json
```

Neither file is touched by any of this lane's commits. The verdict is `PASS`
either way, so nothing is gated on the overcount here — but it is the same
merge-base conflation recorded as UTV2-1755 against
`scripts/ci/proof-binding-validator.ts`, appearing in a second checker. Noted
rather than fixed: correcting it is out of this lane's scope.

`pnpm verify` itself exits 1 in this worktree, and only at `test:live-db` — see
Known gap 1. Every stage before it passes. The live-DB receipt for this lane is
`Writable DB proof (staging only)`, produced by CI at this exact head and
recorded in section 11.

### 10. Migration gates

**Fail-closed precondition.** The migration declares:

```text
-- FAIL-CLOSED-PRECONDITION: public.provider_offer_history_p20260701, public.provider_offer_history_p20261124
```

The guard is not drill-shaped. It exists because "the name is already taken" and
"the partition already exists" are different conditions, and conflating them is
the real hazard: if an in-range target name is occupied by a **standalone**
relation — a hand-created table, a leftover from a `DETACH` that was never
dropped — a bare `to_regclass IS NOT NULL` skip would accept it silently and the
coverage assertion would then pass while the invariant it protects was already
broken. Rows for that day would land nowhere, or in an unmanaged table outside
the partition tree.

So a pre-flight block walks the entire provisioned range **before any DDL** and
raises SQLSTATE `42P07` the moment a target name is occupied by anything that is
not an attached partition of `provider_offer_history`. Skipping stays correct for
genuine partitions, so idempotency is preserved; only the ambiguous case refuses.
The two declared relations are the first and last day of the range, so the drill
exercises both ends of the loop rather than only its first iteration.

**Executed refusal, on staging.** The guard was made to fail on the condition it
names. `provider_offer_history_p20261124` (empty) was `DETACH`ed, producing
exactly the hazard — an in-range name held by a standalone relation — and the
guard body was then run:

```text
DETACH provider_offer_history_p20261124   -- now a standalone relation, in range
run guard  -> SQLSTATE 42P07
   "UTV2-1736: relation public.provider_offer_history_p20261124 already exists and is
    NOT an attached partition of public.provider_offer_history. Refusing before any
    DDL rather than skipping it and reporting coverage that does not exist."
ATTACH provider_offer_history_p20261124 FOR VALUES FROM ('2026-11-24') TO ('2026-11-25')

-- staging restored, verified:
attached_in_range | last_day_reattached
------------------+--------------------
              147 |                   1
```

The assertion was written to raise `DRILL FAILED` on any SQLSTATE other than
`42P07`; it did not raise. Staging carries no residue.

**This staging execution predates the current head, and the migration SQL is
no longer byte-identical to what it exercised.** An earlier revision of this
proof claimed byte-identity; that was true across the rebase but became false
when the security correction was added (section 12). Stating the difference
plainly:

- What changed between that staging run and `b700091eb5b12605141b838297e3f04c1dcb121a`:
  only the function-privilege block — `REVOKE`/`GRANT` statements plus a
  fail-closed assertion over `PUBLIC`, `anon`, and `authenticated`.
- What did **not** change: every `CREATE TABLE ... PARTITION OF` statement, the
  index shape, the coverage assertion, the no-DEFAULT assertion, and the
  rollback script. The seven scenarios below exercise partition provisioning
  and rollback, none of which the security block touches.

The scenarios are retained on that basis, and they are not the only evidence for
the properties they cover: the head-bound equivalents are the precondition drill
and the schema round-trip drill in section 11, which both re-passed at
`b700091eb5b12605141b838297e3f04c1dcb121a` against the current SQL, including all seven precondition cases.
The privilege block added at this head was itself executed and mutation-tested
on staging — section 12. Nothing here rests on the pre-correction staging run
alone.

**Reversibility.** The rollback artifact is
`db/migrations-rollback/20260824000000_utv2_1736_offer_history_forward_partitions.down.sql`.
It reverses exactly what the migration creates — the 147 in-range partitions and
the helper function — refuses any partition holding rows, and never touches the
60 pre-existing partitions, which are outside the provisioned range by
construction. CI's schema round-trip drill (apply -> rollback -> reapply
convergence, scratch Postgres) passes on it.

**Proof-coverage guard.** The `skip-proof-coverage` label is applied.
`proof-coverage-guard` fires on any `supabase/migrations/*.sql` change and asks
for an app-level live-DB proof because that class of change "has shipped broken
because unit tests pass under InMemory while production diverges". That rationale
does not apply here: this PR adds no app runtime code path at all. The monitor is
read-only ops tooling, and the migration's coverage is the three dedicated
scratch-Postgres drills plus Live Schema Parity plus the staging writable-DB
proof — strictly stronger than an InMemory-versus-live comparison.

### 11. CI receipts, at the exact source head

All four migration receipts below were produced by CI at
`b700091eb5b12605141b838297e3f04c1dcb121a`, which is the last commit carrying
non-proof changes. Every commit after it touches proof artifacts only.

| Receipt | Result | Run | Job |
|---|---|---:|---:|
| Fail-closed precondition drill (scratch Postgres) | PASS | 33085979223 | 98565597551 |
| Schema round-trip drill (scratch Postgres) | PASS | 33085979223 | 98565597479 |
| Live Schema Parity | PASS | 33085978601 | 98565631037 |
| Writable DB proof (staging only) | PASS | 33085978369 | 98565908113 |

These supersede the receipt sets captured at `33e76bad` and at `942b15de`. Both
of those heads are void for approval purposes: `942b15de` carried the incomplete
`REVOKE ... FROM PUBLIC` correction, and `b700091e` replaced it (section 12).
Neither the earlier receipts nor any approval pinned to those heads is reused.

The precondition drill's seven cases, verbatim:

```text
migration-precondition-drill: supabase/migrations/20260824000000_utv2_1736_offer_history_forward_partitions.sql
  [PASS] refuses when public.provider_offer_history_p20260701 pre-exists — raised SQLSTATE 42P07
  [PASS] no DDL ran when public.provider_offer_history_p20260701 pre-exists — schema fingerprint identical before and after the attempt
  [PASS] scratch restored after public.provider_offer_history_p20260701 case — back to baseline
  [PASS] refuses when public.provider_offer_history_p20261124 pre-exists — raised SQLSTATE 42P07
  [PASS] no DDL ran when public.provider_offer_history_p20261124 pre-exists — schema fingerprint identical before and after the attempt
  [PASS] scratch restored after public.provider_offer_history_p20261124 case — back to baseline
  [PASS] applies on an empty scratch schema — created all declared relations: public.provider_offer_history_p20260701, public.provider_offer_history_p20261124
migration-precondition-drill: PASS
drilled 1 migration(s)
```

`no DDL ran ... schema fingerprint identical before and after the attempt` is the
load-bearing line: it is what "refused before any DDL" actually means, and it is
why the guard was placed as a pre-flight pass over the whole range rather than
inline in the provisioning loop.

The `Writable DB proof (staging only)` job is the T1 live-DB receipt that cannot
be obtained locally under production containment (Known gap 1). It ran against
staging `xskgrzbteyqdufktjrjx` in the `staging-ci` environment; no production
credential is reachable from it.

### 12. Function privilege lockdown, proven on staging

`list_provider_offer_history_partition_days()` is `SECURITY DEFINER`, and
Supabase exposes public-schema functions as PostgREST RPC. Postgres also grants
EXECUTE on a new function to `PUBLIC` by default. Left alone, that combination
makes the function callable by `anon`.

The first correction issued only `REVOKE ALL ... FROM PUBLIC`. **That was
insufficient, and CI did not catch it.** Supabase ships
`ALTER DEFAULT PRIVILEGES` granting EXECUTE on new public-schema functions to
`anon`, `authenticated`, and `service_role`, so the function is created with
those as *explicit* ACL entries. Revoking from `PUBLIC` removes only the
implicit entry.

Measured on staging `xskgrzbteyqdufktjrjx` **before** the corrected block:

```text
SELECT p.proname, p.prosecdef, array_to_string(p.proacl, E'\n') AS acl
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='list_provider_offer_history_partition_days';

proname                                    | prosecdef | acl
-------------------------------------------+-----------+---------------------------
list_provider_offer_history_partition_days | t         | postgres=X/postgres
                                                       | anon=X/postgres
                                                       | authenticated=X/postgres
                                                       | service_role=X/postgres
```

```text
public_exec | anon_exec | authenticated_exec | service_role_exec
------------+-----------+--------------------+------------------
 f          | t         | t                  | t
```

`has_function_privilege('public', ...)` reported **false** while `anon` reported
**true**. An assertion checking only `PUBLIC` therefore passed on a function any
unauthenticated caller could still invoke. All four CI drills passed it too —
scratch Postgres has neither `anon` nor `authenticated`, so the roles the guard
needed to name did not exist there and the check was trivially satisfied. This
is the same failure mode as a fixture inventing a field: an environment missing
the entity a control names makes the control vacuous while reporting green.

The corrected block revokes per-role, guarded on role existence so the migration
still applies to a scratch Postgres, then asserts fail-closed over every
untrusted role. **After**, on the same staging database:

```text
public_exec | anon_exec | authenticated_exec | service_role_exec | acl
------------+-----------+--------------------+-------------------+--------------------------------------------
 f          | f         | f                  | t                 | postgres=X/postgres | service_role=X/postgres
```

#### Mutation test — the guard fails on the condition it names

Presence of an assertion proves nothing. The condition was re-introduced and the
guard re-run:

```text
GRANT EXECUTE ON FUNCTION public.list_provider_offer_history_partition_days() TO anon;
-- then run the assertion block verbatim:

ERROR:  P0001: MUTATION TEST OUTCOME: UTV2-1736: role anon still holds EXECUTE on
list_provider_offer_history_partition_days() after the REVOKE. Refusing to leave a
SECURITY DEFINER function callable by an untrusted role.
CONTEXT:  PL/pgSQL function inline_code_block line 25 at RAISE
```

The mutation ran inside a `DO` block that aborted, so the temporary `GRANT`
rolled back. Staging was re-read afterwards and confirmed at
`postgres=X/postgres | service_role=X/postgres`.

The whole block sits inside the migration's single transaction (`BEGIN;` .. 
`COMMIT;`), so a migration that cannot reach the secure state does not commit
partitions either.

**Production impact: none from this PR.** The privilege state above was
established on staging only. Production `zfzdnfwdarxucxtaojxm` was read-only
throughout; the function does not exist there, because the migration has not
been applied. Applying it remains a separate, deliberate production decision.

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

2. **The branch was 23 commits behind `origin/main`; that is now resolved, and
   how it surfaced is worth recording.** Falling behind reddened the required
   proof-binding check with a list of sixteen offending files, *none of which
   this lane touched* — `scripts/ops/lane-start.ts`, `CLAUDE.md`,
   `.ops/sync/UTV2-1512.yml` and others, all arriving from `main`. The cause is
   `scripts/ci/proof-binding-validator.ts:161`, which takes `head` from
   `GITHUB_SHA`; on a `pull_request` event that is the **merge ref**, so the
   `verified_source_sha..head` diff sweeps in everything `main` gained since the
   anchor. The gate cannot distinguish "the lane changed non-proof files after
   its anchor" from "`main` moved". That defect is recorded separately for
   normal admission and is deliberately **not** fixed in this lane.

   The sync itself was performed with the sanctioned
   `ops:merge-wrapper git-rebase-main` (merge lock acquired and released), onto
   `origin/main` `e0bc1480`. `git-merge-main` was unusable: it is implemented as
   `git merge --ff-only origin/main` (`scripts/ops/ops-merge-wrapper.ts:93-97`)
   and cannot sync a diverged branch — a separate wrapper defect, also recorded
   for separate admission.

   The rebase produced **zero conflicts**, and that was verified rather than
   assumed: `main` touched none of this lane's twelve files, and
   `git diff 36ba76f2 HEAD` over those twelve files is empty, so no accepted
   behaviour changed and no scope expanded. The branch is now 9 ahead / 0 behind.
   Pre- and post-rebase heads are preserved at
   `refs/heads/preserve/utv2-1736-pre-rebase-36ba76f2` and
   `refs/heads/preserve/utv2-1736-post-rebase-a59bd20c`.

   Every artifact pinned to the pre-rebase head is void and was **regenerated,
   not reused**: all four CI receipts, every command receipt in section 9, and
   the EXECUTOR_RESULT comment. The scope-override comment must likewise be
   re-pinned to `b700091eb5b12605141b838297e3f04c1dcb121a`.

3. **The real-sink proof was executed by driving the real function's output into
   staging's real `system_runs` and `audit_log`**, because staging service-role
   credentials are not available locally under production containment. Closing
   the last gap — an automated in-CI integration test — would require editing
   `package.json` and adding a live T1 proof file, both outside `file_scope_lock`.

4. **No automated gate can catch a regression of the privilege lockdown, and I
   did not add one in this lane.** The in-migration assertion is the real
   control and it is execution-proven (section 12) — but it can only fire where
   the roles it names exist. CI's scratch Postgres has no `anon` or
   `authenticated`, so the per-role branch is skipped there and the drills stay
   green. `Live Schema Parity` compares schema shape, not function ACLs.

   Concretely: if someone deleted the `REVOKE`/assert block from this migration,
   every gate on this PR would still pass. The protection today rests on the
   assertion running at **apply** time against a real Supabase database, which
   is genuine but is not a merge-time guard.

   Closing this properly means a test that asserts the migration text still
   revokes from `PUBLIC`, `anon`, and `authenticated`. That file
   (`scripts/ops/partition-provisioner.test.ts`) is already inside this lane's
   `file_scope_lock`, so it is in scope — but adding it moves the substantive
   anchor again and forces a third full re-verification cycle on this PR. I am
   flagging it rather than deciding it unilaterally. Say the word and I will add
   it; otherwise it should become a follow-up issue before the migration is
   applied to production.

## Scope

No production DDL. No partition drop, detach, pruning, retention activation, or
audit-log mutation. No SGO, ingestion restart, worker start, queue replay,
delivery activation, system picks, or member-facing output. The monitor is
read-only and issues no DDL.
