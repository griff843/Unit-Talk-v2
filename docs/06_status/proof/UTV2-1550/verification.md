# PROOF: UTV2-1550

MERGE_SHA: 1d555828eed109bfe3d33f8e9cc5caa1aa202db8

Approved head (PR #1239, pm-verdict/v1 APPROVED by griff843): 88693ae3d03e0202692838db678c5d5a7e372f40
Squash-merged to main as: 1d555828eed109bfe3d33f8e9cc5caa1aa202db8

Known gap: the pull_request-triggered "Executor Result Validation"/"Executor
Result Validator" check never went green on this PR's own commits. The
Codex P1 checkout-ref-pin fix (below) pins checkout to the PR base SHA for
privilege-boundary reasons, but `scripts/ops/executor-result-validate.ts` is
itself a new file introduced by this same PR — it does not exist at the base
ref, so the workflow's "Resolve check name" step fails with
`ERR_MODULE_NOT_FOUND` on every pull_request-triggered run of this specific
PR. This is a one-time self-referential bootstrap gap: future PRs will not
hit it, since main will already contain the file at their base SHA once this
PR merges. PM (griff843) merged with full repo-owner authority notwithstanding
this gap; P0 Protocol also has no result on the merge commit since it only
runs on pull_request, not push.

## Verification

## Summary

Root-caused and fixed the stale-required-check-identity bug that blocked
PRs #1227/#1229/#1235 for hours despite all required checks reporting
green. Full incident writeup:
`docs/06_status/INCIDENTS/INC-2026-07-17-utv2-1550-stale-required-check-identity.md`.

## ASSERTIONS:

- [x] pull_request-triggered evaluation never creates the required "Executor Result Validation" check — it always uses the distinct "Executor Result Preflight" name
- [x] Only issue_comment and workflow_dispatch ever create the required context
- [x] Check-name resolution is a small, pure, unit-tested function (resolveCheckName), not duplicated inline in the workflow
- [x] Field-level comment validation extracted into the same tested module
- [x] Workflow looks up the check name via the tested CLI, verified by a dedicated test asserting the workflow step calls that exact script
- [x] Existing workflow-hardening test updated: the old assertion required job.name to literally equal the required check name, which would have let the job's own native per-job check recreate the exact bug regardless of the dynamic custom-check logic
- [x] 21 new unit tests covering: missing result, valid result, corrected result superseding a stale one, and the exact head-change scenario that caused the incident always resolving to the non-required name
- [x] pnpm verify PASS (full local run, exit code 0)
- [x] pnpm test:db PASS (7/7, live Supabase)
- [x] r-level-check PASS, no artifacts required for this diff
- [x] Temporary recovery procedure (re-run the original pull_request-triggered run's failed jobs) documented for branches predating this fix
- [x] Follow-up (Codex P1): Checkout ref pinned to `github.event.pull_request.base.sha` on pull_request events so the checks:write "Resolve check name" step never executes PR-controlled code
- [x] Adversarial regression test asserts the exact pinned-ref expression, so a future edit cannot silently reintroduce the PR-controlled checkout

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/executor-result-validate.test.ts
1..21
# tests 21
# pass 21
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
```

Re-run after the Codex P1 checkout-ref-pin follow-up (same head):

```text
$ pnpm verify
1..3728
# pass 3728
# fail 0
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 14
Rules matched: (none) — no R-level artifacts required for this diff
```

## Root cause (see incident doc for full detail)

Both `pull_request` and `issue_comment` triggers created check runs under the
same required name. A push re-evaluating a stale executor-result comment
could create a failing run under that name; a later successful
issue_comment-triggered run under the same name did not reliably supersede
it for merge-eligibility purposes. Empirically confirmed and resolved three
times on live PRs by re-running the *original* pull_request-triggered run's
failed jobs specifically.

## Follow-up: privilege-boundary hardening (Codex P1)

The "Resolve check name" step ran the checked-out copy of
`scripts/ops/executor-result-validate.ts` in a job holding `checks: write`.
`actions/checkout` defaults to the PR's own head/merge ref on `pull_request`
events — attacker-controlled — so a PR could have modified that script to
defeat this lane's own fix. Pinned the Checkout `ref` to
`github.event.pull_request.base.sha` on `pull_request` (immutable, never
PR-supplied); `issue_comment`/`workflow_dispatch` keep the default
`github.sha`, already safe for those trigger types. The "Validate executor
result" `github-script` step was already safe (script content lives in the
trusted YAML, reads PR state only via the REST API). Full detail:
`docs/06_status/INCIDENTS/INC-2026-07-17-utv2-1550-stale-required-check-identity.md`.

## Addendum: file_scope_lock reconciliation (2026-07-21, branch claude/utv2-1550-scope-reconcile)

Narrowed `file_scope_lock` to drop the stale `package.json` entry. This issue's own implementation
is fully merged (PR #1239, main); no further active editing is happening under this issue, but the
lock still blocked a later, unrelated lane (UTV2-1560/#1271) from touching the same `package.json`
line under its own scope. `status` remains `merged` (honest — this lane still cannot mechanically
reach `done` via `ops:lane-close --repair-merged`: `Executor Result Validation` and `P0 Protocol`
only trigger on PR-scoped GitHub events and this PR is closed/merged, so they can never
re-evaluate on this merge commit — a separate, pre-existing gap this reconciliation does not
attempt to resolve). `pnpm verify` PASS on branch `claude/utv2-1550-scope-reconcile`.

## Owner boundary

T1 — merge authority and repository enforcement configuration. Requires the
`t1-approved` label and a valid Griff-authored `pm-verdict/v1` APPROVED
comment bound to the reviewed head. This proof supplies neither.
