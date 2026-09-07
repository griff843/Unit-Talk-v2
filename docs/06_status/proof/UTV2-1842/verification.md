# PROOF: UTV2-1842

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-07T04:54:47.000Z
Issue: UTV2-1842
Tier: T1
Lane type: runtime
Branch: claude/utv2-1842-smart-form-submission-repair
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1529
Head SHA: 9c4c8485cde9b58d5c4b6f697462280c2e919514
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

## EVIDENCE:

Measured at head 9c4c8485cde9b58d5c4b6f697462280c2e919514 in the lane worktree.

```
$ pnpm type-check
exit 0

$ pnpm test
# tests 6008
# pass 6008
# fail 0
exit 0

$ pnpm exec tsx --test apps/api/src/submission-service.test.ts apps/api/src/smart-form-validation.test.ts apps/api/src/controllers/submit-pick-controller.test.ts
# tests 156
# pass 156
# fail 0

$ pnpm verify
# verify = verify:static && test:live-db
# verify:static -- all eleven stages exit 0:
#   ci:db-client-boundary OK   ops:sync-check OK   ops:system-alignment-check OK
#   ops:automation-coverage-check OK   env:check OK   lint OK   type-check OK
#   build OK   test OK   @unit-talk/smart-form verify OK   verify:commands OK
# test:live-db -- NOT run locally. This workstation is under production containment
#   (SUPABASE_URL is the documented 127.0.0.1:1 placeholder), so no live database is
#   reachable. The obligation is recorded on this lane's manifest as
#   t1_live_db_precondition: "deferred_to_ci" under the ratified route B admission, and
#   is discharged by CI on the PR head -- see Runtime Verification below.
```

## Verification
- [x] `pnpm type-check`: exit 0 at 9c4c8485cde9b58d5c4b6f697462280c2e919514
- [x] `pnpm test`: exit 0 at 9c4c8485cde9b58d5c4b6f697462280c2e919514, 6008/6008 pass
- [x] `pnpm verify`: `verify:static` green in full at 9c4c8485cde9b58d5c4b6f697462280c2e919514; `test:live-db` deferred to CI
      per the recorded `t1_live_db_precondition: deferred_to_ci` and satisfied there
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: run by the
      R-Level Compliance Check job on this PR, which passed

## Runtime Verification

The live-database half of this lane's verification was obtained in CI at the PR head, not on
this contained workstation. Both receipts are on GitHub Actions run
`34079964826` for PR #1529:

- `Writable DB proof (staging only)` — **pass**, 9m11s. This is the job that executes against
  the real staging database (`assert-staging-target.ts` pins it to `xskgrzbteyqdufktjrjx`).
- `verify` — **pass**, 3m29s.

These are the two contexts `truth-check` G6 requires on the merge SHA for a lane carrying
`t1_live_db_precondition: "deferred_to_ci"`; G6 re-asserts both directly at closeout rather
than trusting the branch result recorded here.

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
Execution SHA: 9c4c8485cde9b58d5c4b6f697462280c2e919514
