# PROOF: UTV2-1551

MERGE_SHA: f593fb7c6efece9755611316b36a1b54cdf394bb

## Verification

## Summary

Fixes the first half of the root cause discovered while draining PRs
#1240/#1241/#1242/#1243/#1244/#1245 during this session: a freshly-opened PR
could sit `mergeStateStatus: BLOCKED` indefinitely because the required
`Merge Gate` check literally never ran — not failed, never executed. Two
compounding gaps: `merge-gate.yml`'s `pull_request` trigger omits `opened`
(deferred to a follow-up commit — see below), and `tier-label-check.yml`'s
label-add used the default `GITHUB_TOKEN`, whose `labeled` event doesn't
cascade to trigger other workflows (fixed here).

## ASSERTIONS:

- [x] Tier-label sync now authenticates with `SYNC_BOT_TOKEN`, fail-closed with **no** `GITHUB_TOKEN` fallback — a silent fallback would silently reintroduce the exact non-cascading-event bug this secret exists to fix
- [x] An explicit guard step fails the job with a clear error if `SYNC_BOT_TOKEN` is unset, rather than letting `actions/github-script` fail opaquely on an empty token
- [x] A label added this way is a genuine cascading GitHub event other workflows' `pull_request: labeled` triggers can see
- [x] "Comment on blocked tier state" step deliberately left on the default token — it only posts a comment, nothing needs to cascade from it
- [x] `SYNC_BOT_TOKEN` added to `docs/05_operations/REQUIRED_SECRETS.md`'s canonical inventory (it was previously used by `post-merge-lane-close.yml` without ever being documented there); both consumers listed
- [x] Regression test asserts the fail-closed guard step and the exact `github-token` expression with no fallback
- [x] pnpm verify PASS (3727/3727, full local run, exit code 0)
- [x] pnpm test:db PASS (7/7, live Supabase)
- [x] r-level-check PASS, no artifacts required for this diff

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
1..28
# tests 28
# pass 28
# fail 0
# cancelled 0
# skipped 0
```

```text
$ pnpm test:db
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 112295.399457
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

## Sequencing note

`merge-gate.yml`'s missing `opened` trigger type (the other half of the
root cause) is deferred to a follow-up commit on this same branch, once
the concurrently in-flight UTV2-1543 lane (PR #1246, which holds
`merge-gate.yml` in its own file-scope lock) merges. `ops:lane-start`
correctly blocked the file-scope overlap when both were attempted at once;
this is intentional serialization, not an oversight.

## Owner boundary

T1 — merge authority and repository enforcement configuration. Requires the
`t1-approved` label and a valid Griff-authored `pm-verdict/v1` APPROVED
comment bound to the reviewed head. This proof supplies neither.
