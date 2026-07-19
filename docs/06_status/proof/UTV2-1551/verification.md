# PROOF: UTV2-1551

MERGE_SHA: 86132abd6edd815d8e0bb542f1fd1f3f3f25756b

The SHA above is the pre-merge implementation commit on
`claude/utv2-1551-merge-gate-continuation` (an ancestor of the eventual PR
head/merge commit — a file cannot contain its own future commit hash, so this
binds to the exact reviewed implementation commit per repo convention).

## Verification

## Summary

Continuation lane for the "Merge Gate never evaluates on fresh PRs" root
cause, opened fresh from current `main` per instruction after the prior
attempt (PR #1247) hit its T1 bounce cap and went conflicting. Closes both
compounding gaps: (1) `tier-label-check.yml`'s label sync used the default
`GITHUB_TOKEN`, whose `labeled` events don't cascade to trigger other
workflows, so it could never fire Merge Gate's own `pull_request: labeled`
trigger; (2) `merge-gate.yml`'s own `pull_request` trigger omitted `opened`
entirely, so a brand-new PR got zero Merge Gate evaluation from PR creation
itself either.

## ASSERTIONS:

- [x] `tier-label-check.yml`'s tier-label sync step authenticates with
  `secrets.SYNC_BOT_TOKEN`, fail-closed with **no** `GITHUB_TOKEN` fallback
- [x] A `Require SYNC_BOT_TOKEN` guard step fails the job with a clear
  `::error::` message if the secret is unset, before the sync step runs
- [x] `SYNC_BOT_TOKEN` is documented in `docs/05_operations/REQUIRED_SECRETS.md`,
  listing both `post-merge-lane-close.yml` and `tier-label-check.yml` as
  consumers (it was previously used by the former without ever being
  inventoried there)
- [x] `merge-gate.yml`'s `pull_request.types` now includes `opened`
  (`[opened, synchronize, reopened, labeled, unlabeled, ready_for_review]`)
- [x] The gate job's `if:` condition already runs unconditionally for every
  `pull_request` event, so no separate `if:` change was required for `opened`
  evaluation to take effect
- [x] Reviewed the full gate job body: tier resolution reads the lane
  manifest via the Contents API (not GitHub labels), and T1/T2 verdict
  checks already fail closed with a clear BLOCKED status when no tier
  label / manifest / PM verdict exists yet — a fresh `opened` PR gets an
  immediate, visible BLOCKED status, never a premature approval
- [x] Updated the now-superseded regression test (`required PR check
  workflows do not create stale merge-gate contexts on opened events`,
  originally added under an earlier lane) to assert the opposite, with
  commentary on why the original "labels must settle first" premise did not
  hold
- [x] Added a new regression test asserting `merge-gate.yml`'s
  `pull_request.types` includes `opened` and that the gate job's own `if:`
  has no narrower per-type restriction
- [x] Corrected `docs/05_operations/REQUIRED_CI_CHECKS.md`'s stale Merge Gate
  trigger-list prose to match the actual (and now updated) trigger types
- [x] No branch-protection setting, required-status-check context, or
  repository ruleset touched
- [x] `pnpm verify:parallel` PASS (full local run, exit code 0)
- [x] `pnpm test:db` PASS (7/7, live Supabase)
- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts` PASS (33/33)
- [x] `r-level-check` PASS, no artifacts required for this diff

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
1..33
# tests 33
# suites 0
# pass 33
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 753.058911
```

```text
$ pnpm test:db
> @unit-talk/v2@0.1.0 test:db
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 108075.744855
```

```text
$ pnpm verify:parallel
...
[verify:parallel] all checks passed
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

## Sequencing note

This supersedes PR #1247, which implemented root cause #1 only and
explicitly deferred root cause #2 (this PR's `opened` trigger addition)
because `merge-gate.yml` was held in a concurrent lane's file-scope lock at
the time. That prior PR is now stuck at its T1 bounce cap and `CONFLICTING`
against current `main`; per instruction this lane reimplements both fixes
cleanly from current `main` rather than resolving those conflicts. PR
#1247's CHANGES_REQUIRED verdict history is prior review record for the
carried-forward part-1 content and should be considered alongside this PR's
own review.

## Owner boundary

T1 — merge authority and CI policy-engine configuration. Requires the
`t1-approved` label and a valid Griff-authored `pm-verdict/v1` APPROVED
comment bound to the reviewed head. This proof supplies neither; it is
implementer-side mechanical verification only.
