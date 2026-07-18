# PROOF: UTV2-1543

MERGE_SHA: 156d61d2a11a503e5115ca03a9dd2dbc38aa61b9

## Summary

Extends Merge Gate's T1 `pm-verdict/v1` acceptance to require and validate
`PR:` and `Head SHA:` against the live PR — an APPROVED verdict bound to a
stale head (after a rebase or any push) now fails closed instead of
mechanically satisfying the gate. Canonical fix for the gap first observed
on PR #1223 and independently rediscovered this session while rebasing
#1230/#1231/#1232 (filed as UTV2-1552, ruled a duplicate of this issue).

## Codex P1 fix (this revision)

The `gate` job had no `actions/checkout` step at all before this lane's
new `require('./scripts/ops/merge-gate-verdict.cjs')` — every Merge Gate
evaluation (not just T1) would have thrown before the check run was even
created. Added a Checkout step, pinned to the PR's base SHA on
`pull_request(_review)` events for the same privilege-boundary reason as
the Executor Result Validator fix (UTV2-1550): this job holds
`checks`/`pull-requests`/`issues: write`, and the default checkout ref is
the PR's own content on those event types — a PR could otherwise modify
`merge-gate-verdict.cjs` to defeat its own T1 freshness check.
`issue_comment`/`workflow_dispatch` keep the default `github.sha`, already
safe. Regression test asserts the Checkout step exists, runs before the
Evaluate merge gate step, and is pinned to the exact base-SHA expression.

## Verification

## ASSERTIONS (issue acceptance tests):

- [x] AC1: exact issue/PR/head APPROVED verdict passes
- [x] AC2: approved verdict for an earlier head fails after a rebase or push
- [x] AC3: wrong PR number fails
- [x] AC4: missing Head SHA fails
- [x] AC5: CHANGES_REQUIRED remains authoritative when latest
- [x] AC6: a byte-identical rebase still requires a newly bound human verdict — no content-based inference (validateT1Verdicts only ever compares the declared Head SHA string, never diff content)
- [x] AC7: existing T2 behavior is unchanged (validateT1Verdicts has no T2 code path)
- [x] Canonical pm-verdict/v1 schema doc updated with the new required fields and validation rule
- [x] Bot-authored and non-CODEOWNERS verdicts still rejected
- [x] Bounce-limit behavior (3 CHANGES_REQUIRED trips it) preserved
- [x] Parsing/validation extracted into a tested module (scripts/ops/merge-gate-verdict.cjs), not duplicated inline in the workflow — regression test asserts the workflow requires it rather than hand-duplicating parseVerdict
- [x] pnpm verify PASS (3727/3727, full local run, exit code 0)
- [x] r-level-check PASS, no artifacts required for this diff

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/merge-gate-verdict.test.ts
1..16
# tests 16
# pass 16
# fail 0
# cancelled 0
# skipped 0
```

```text
$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
1..29
# tests 29
# pass 29
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
# duration_ms 112966.359507
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

## Design note: why a `.cjs` module instead of inline logic or a TypeScript import

`actions/github-script`'s `script:` block runs plain Node, not `tsx` — it
cannot import `.ts` files without a build step. Following the same working
precedent already in this repo (`codex-return-review.yml` uses
`require('/tmp/r-level-result.json')` to load a file written by a prior step),
`scripts/ops/merge-gate-verdict.cjs` is plain CommonJS so the workflow's
`require('./scripts/ops/merge-gate-verdict.cjs')` resolves directly from the
checked-out workspace — no separate shell-step/env-var handoff needed, and no
inline duplication of the parsing/validation logic for tests to drift from.

## Owner boundary

T1 — merge authority and repository enforcement configuration (this lane
touches `.github/workflows/merge-gate.yml` directly, a singleton/governance
path). Requires the `t1-approved` label and a valid Griff-authored
`pm-verdict/v1` APPROVED comment bound to the reviewed head, per UTV2-1543's
own new rule. This proof supplies neither.
