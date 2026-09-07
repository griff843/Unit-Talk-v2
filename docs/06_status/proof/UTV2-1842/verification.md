# PROOF: UTV2-1842

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-07T07:25:00.000Z
Issue: UTV2-1842
Tier: T1
Lane type: runtime
Branch: claude/utv2-1842-smart-form-submission-repair
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1529
Head SHA: b80384b79918f7eca765c25533b69643e6178b74
result: pass

## ASSERTIONS:

- [x] A Smart Form submission whose participant resolution is a validated manual
      `canonical-coverage-gap` override reaches persistence instead of being refused with
      422 EVENT_NOT_FOUND by the event-existence gate.
- [x] A Smart Form submission whose participant resolution is a validated structured team
      fallback for a canonical team sport likewise reaches persistence.
- [x] The waiver is gated on server-validated fallback eligibility, not on a bare null
      `eventId`: both outcomes are produced only after `validateManualResolution` or
      `validateStructuredTeamFallback` has completed successfully.
- [x] A submission that resolved a canonical event is still refused when its `eventName`
      matches no row.
- [x] A `smart-form` payload carrying none of the Smart Form fields (`not-smart-form`) does
      not waive the gate.
- [x] `processSubmission` called without the outcome argument still enforces the gate, so
      the waiver is fail-closed by default.
- [x] A non-team sport with no canonical event still fails rather than reporting a fallback.
- [x] The waived path creates no delivery work: the persisted pick is `track-only`, keeps its
      `canonical-coverage-gap` provenance and `eventId: null`, and enqueues no outbox row.
- [x] Against a **real** staging Postgres, a manual coverage-gap Track Only pick persists, and
      the row read back over PostgREST -- not through the repository that wrote it -- carries
      `resolution: manual`, `reason: canonical-coverage-gap` and `eventId: null`.
- [x] Against that same database, the pick creates **zero** `distribution_outbox` rows,
      asserted by querying the delivery queue itself rather than by trusting the controller's
      own `outboxEnqueued: false`.
- [x] The live acceptance above is not a dormant gate: the same suite, against the same armed
      `events` table and the same unmatched event name, refuses a submission carrying no
      server-validated fallback outcome.

## EVIDENCE:

Attribution is exact, because two different heads are involved. `9c4c8485c` is where the
implementation and its unit controls were measured locally in full. `b80384b79` is this
bundle's anchor -- the last non-proof commit -- and adds four things to that: the live-DB proof
suite, its one-line wiring into `test:t1-proof:live`, its entry in the DB writer inventory, and
the one-file admission of that inventory into `.lane/lanes/runtime.yml`. The new suite is NOT
reachable from `pnpm test` -- `test:apps-api-core` and `test:t1-proof:local` are explicit file
lists, not globs -- so the local suite's composition is unchanged between the two.

The fourth item is an allowlist admission correction, not a policy change. `Lane authority`
failed at the previous head with the single finding `outside_allowed_paths:
docs/05_operations/db-writer-classification.json`, and no runtime lane could legally carry its
own live-DB proof without it, because a live-DB proof has exactly two mandatory registration
points and neither is under `apps/**`. It was admitted as one exact file, in the same narrow
form as `packages/contracts/src/promotion.ts` and `smart-form.ts` already in that file, rather
than as a `docs/05_operations/**` glob. `pnpm lane:check --lane runtime` now reports
`PASS lane=runtime files=15`, where it reported the violation above at the previous head.

```
$ pnpm type-check
exit 0 at b80384b79918f7eca765c25533b69643e6178b74

$ pnpm lint
exit 0 at b80384b79918f7eca765c25533b69643e6178b74

$ pnpm exec tsx scripts/ci/db-writer-inventory.ts
{ "ok": true, "discovered_credentialed_tests": 51, "errors": [] }

$ pnpm exec tsx --test apps/api/src/submission-service.test.ts apps/api/src/smart-form-validation.test.ts apps/api/src/controllers/submit-pick-controller.test.ts
# tests 156
# pass 156
# fail 0

$ pnpm test
# 6008/6008 pass, 0 fail -- measured locally at 9c4c8485cde9b58d5c4b6f697462280c2e919514.
# NOT re-measured locally at this anchor: the re-run was killed by the low-memory monitor on
# this 15Gi workstation. The authority for `pnpm test` at THIS head is therefore the required
# `verify` check below, not a local claim, and this bundle does not assert one.

$ pnpm verify
# verify = verify:static && test:live-db
# verify:static -- green in full locally at 9c4c8485c (all eleven stages exit 0:
#   ci:db-client-boundary, ops:sync-check, ops:system-alignment-check,
#   ops:automation-coverage-check, env:check, lint, type-check, build, test,
#   @unit-talk/smart-form verify, verify:commands), and independently reproduced in CI at
#   b80384b79 by the required `verify` check, which runs the identical chain:
#   every TAP block in that job totals 6631 tests, 6631 pass, 0 fail, 0 skipped.
# test:live-db -- NOT run locally. This workstation is under production containment
#   (SUPABASE_URL is the documented 127.0.0.1:1 placeholder), so no live database is
#   reachable. The obligation is recorded on this lane's manifest as
#   t1_live_db_precondition: "deferred_to_ci" under the ratified route B admission, and
#   is discharged by CI on the PR head -- see Runtime Verification below.
```

## Verification
- [x] `pnpm type-check`: exit 0 at b80384b79918f7eca765c25533b69643e6178b74
- [x] `pnpm test`: green at this anchor via the required `verify` check in CI (run 34093798436,
      job 101654390075); the last local full-suite run was 6008/6008 at 9c4c8485c
- [x] `pnpm verify`: `verify:static` reproduced green in CI at b80384b79918f7eca765c25533b69643e6178b74;
      `test:live-db` deferred to CI per the recorded `t1_live_db_precondition: deferred_to_ci`
      and satisfied there
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: run by the
      R-Level Compliance Check job on this PR, which passed

## Runtime Verification

The live-database half of this lane's verification was obtained in CI at the PR head, not on
this contained workstation. Both receipts are on GitHub Actions run `34093798436` for PR
#1529, at head `b80384b79918f7eca765c25533b69643e6178b74`:

- `Writable DB proof (staging only)` -- **pass**, job `101652781269`, 07:05:52Z-07:12:16Z. This
  is the job that executes against the real staging database; `assert-staging-target.ts` pins
  it to `xskgrzbteyqdufktjrjx` and the job logged
  `[assert-staging] OK: target is the approved staging project`.
- `verify` -- **pass**, job `101654390075`, 07:12:19Z-07:16:54Z.

These are the two contexts `truth-check` G6 requires on the merge SHA for a lane carrying
`t1_live_db_precondition: "deferred_to_ci"`; G6 re-asserts both directly at closeout rather
than trusting the branch result recorded here.

Receipts inside that job, read from its TAP output rather than recalled:

```
pnpm test:db
# tests 7
# pass 7
# fail 0
# skipped 0
# duration_ms 79794.810216

pnpm test:t1-proof:live -> apps/api/src/t1-proof-utv2-1842-fallback-event-gate.test.ts
ok 1 - UTV2-1842 live DB: a manual coverage-gap Track Only pick persists with honest provenance and creates no delivery row
ok 2 - UTV2-1842 live DB: the event-existence gate is still armed - a smart-form pick with no server-validated fallback is refused
# tests 2
# pass 2
# fail 0
# skipped 0
# duration_ms 16383.28568
```

These are the values from run `34093798436`, read out of the job's TAP output; the previous
head's numbers were replaced rather than carried forward.

`skipped 0` is load-bearing in both blocks. These suites gate themselves on a Supabase
credential and report `skip` when none is present, so a run that reached the database and a
run that quietly asserted nothing are otherwise indistinguishable from an exit code.

### The live suite leaked its arming rows, and that broke an unrelated PR

Recorded because it is a defect this lane introduced and then repaired, and because the
mechanism is reusable knowledge rather than a one-off.

`armTheGate` upserts an event for the sole purpose of making `events` non-empty, because
`checkEventExistenceGate` (`submission-service.ts:867`) skips entirely when the table is empty.
This file's original fixture policy was that nothing it creates is deleted -- correct for its
evidence rows, and wrong for these two, because unlike every other row here they mutate a
GLOBAL precondition.

Measured on 2026-09-07: ten such rows accumulated across five staging runs (05:26, 05:35,
05:54, 06:15 and 06:29Z, one pair per run) and turned
`apps/api/src/t1-proof-awaiting-approval.test.ts`'s UTV2-1672 Track Only suite red on PR
**#1530**, a PR touching only `apps/smart-form/**`. That suite's manual coverage-gap submission
reaches 201 only while the gate is dormant, so it failed with `No event found matching "UTV2-1672
Proof Away ... at UTV2-1672 Proof Home ..."`, taking two dependent tests with it. Because
`verify` fails closed on the staging job, the leak took a **required** check red on an
unrelated PR. The same suite passed on #1527 at 01:20Z, before the first leak -- the timeline
matches exactly.

The repair is an `after` hook that deletes by `external_id`, this run's own namespace
(`utv2-1842-<RUN_ID>-<label>`), so a concurrent run's arming rows and every pre-existing row
are untouched. Cleanup failure is asserted rather than swallowed, the deleted count must equal
the created count, and a final query asserts zero rows matching this file's name prefix
survive.

**Proven against live data, not argued.** Before the fix each staging run left two rows behind;
the staging job on this head armed the gate and left **zero**, read back directly:

```
select count(*) as events_now,
       count(*) filter (where event_name like 'UTV2-1842 unrelated event %') as arming_leaked
  from events;
-- events_now 0, arming_leaked 0   (staging xskgrzbteyqdufktjrjx, after run 34093798436)
```

The ten already-leaked rows were deleted directly from staging after confirming zero dependent
rows in all five tables carrying an `events` foreign key (`alert_detections`,
`event_participants`, `game_results`, `hedge_opportunities`, `market_universe`). `events`
returned to 0 -- its state before this file's first run.

This is the CI-fixture-contamination class already on record for the staging project. What is
new is that it reached a required check.

### Why the live suite is not vacuous

The live suite was not mutation-tested, because mutating it costs a full staging run. Its
anti-vacuity control is inside the suite instead, and is stronger than a build-level mutation
would have been: tests 1 and 2 run in the same process, against the same database, with the
same armed `events` table and the same run-unique event name that matches no row. The ONLY
difference between them is whether the submission carries a server-validated fallback outcome.
Test 2 was refused and test 1 was accepted, which isolates the waiver as the cause of the
acceptance without needing a second build. The predicate itself is separately mutation-tested
four ways in process, below.

## Mutation Controls

Each mutation was applied to the working tree, the affected suites re-run, and the mutation
reverted. Every one turns a distinct assertion red:

| # | Mutation | Result |
|---|---|---|
| 1 | drop `manual-coverage-gap` from `eventCheckWaived` | `not ok` — *manual coverage-gap outcome waives the event existence gate* (142 pass / 1 fail) |
| 2 | drop `structured-team-fallback` from `eventCheckWaived` | `not ok` — *structured team fallback outcome waives the event existence gate* (142 pass / 1 fail) |
| 3 | rewrite the predicate as `smartFormOutcome?.kind !== 'canonical-event'` (the fail-open inversion) | `not ok` ×2 — *not-smart-form outcome does NOT waive…* **and** the pre-existing *event gate: pick with unknown eventName is rejected when events repo is populated* (141 pass / 2 fail) |
| 4 | controller stops passing the outcome to `processSubmission` (unwire) | `not ok` — *a manual coverage-gap Track Only pick persists while the events catalog holds only other events* (12 pass / 1 fail) |

Mutation 4 is the one neither unit suite can see. Without the controller-level test the wiring
could be deleted with every other test in the repository still green — the same failure shape
as the executor-result-validator duplication.

Mutation 3 is caught twice, and the second catch is a test that predates this lane. That is
the control which fails if the predicate is ever rewritten into a fail-open.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1529
Approved PR head: pending merge
Execution SHA: b80384b79918f7eca765c25533b69643e6178b74
