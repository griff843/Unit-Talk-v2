# PROOF: UTV2-1573

| Field | Value |
| --- | --- |
| Issue | UTV2-1573 |
| Tier | T1 |
| Branch | claude/utv2-1573-executor-result-validator-pagination |
| Commit SHA(s) | `e10414799ce6366b186d247dc18463a158b92b36` (rebased implementation commit, pre-merge) |

MERGE_SHA: e10414799ce6366b186d247dc18463a158b92b36

(This is the branch head SHA, used here to satisfy proof/merge-SHA binding
without a circular self-reference. The real merge SHA is additionally
recorded post-merge by the standard `ops:proof-generate --merge-sha`
closeout step, which rewrites the "Commit SHA(s)" row above and the
"Merge SHA Binding" section below to the true merge SHA -- see
`rebindVerificationMdSha` in `scripts/ops/proof-generate.ts`.)

## Merge SHA Binding

Pending -- rebound automatically post-merge.

## Verification

## Summary

Fixes a false-negative in the required "Executor Result Validation" check.
`.github/workflows/executor-result-validator.yml` fetched a commit's
check-runs via `github.rest.checks.listForRef({ owner, repo, ref: headSha })`
with no pagination. GitHub's Checks API defaults to 30 results per page.
This repo routinely accumulates 60-100+ check-runs on a single commit
(dozens of required and advisory workflows and matrix jobs firing per
push), so a genuinely successful `verify` check-run can fall outside the
first page returned -- the validator then reports `CI check "verify" not
found on HEAD SHA ...` even though `verify` actually completed
successfully. That failure closes the *required* check for a reason
completely unrelated to the PR's real state.

## Discovery

Reproduced live on an unrelated, already-approved lane whose head carried
67 total check-runs. Its `verify` job completed successfully but was not
among the first 30 entries returned by the unpaginated call, so `Executor
Result Validation` failed closed on a false premise and blocked an otherwise
eligible merge. Comparison against the then-current `main` confirmed that
the defect pre-existed that lane's content.

## Fix

- Replaced the single-page `checks.listForRef` call with
  `github.paginate(github.rest.checks.listForRef, { owner, repo, ref: headSha, per_page: 100, filter: 'latest' })`,
  which walks every page GitHub returns -- no upper bound, so it does not
  merely raise the ceiling from 30 to 100.
- Extracted the "pick the run this validator should trust" logic into
  `scripts/ops/executor-result-check-selection.cjs`
  (`selectLatestVerifyCheckRun`), required directly by the
  `actions/github-script` step -- the same pattern already used by
  `scripts/ops/merge-gate-verdict.cjs` for `merge-gate.yml`, and for the
  same reason: an inline `script:` block in a workflow YAML file is a
  string, not a unit-testable function, so real selection semantics (newest
  wins, wrong app ignored, fail closed) need to live in a plain CommonJS
  module the step can `require()` at runtime.
- Selection is by check-run `id` (monotonically assigned by GitHub at
  creation), not `started_at`, since two runs created in the same second
  would tie on a timestamp but never on `id`.
- The existing three-branch fail-closed structure (`not found` / `not
  completed` / `conclusion !== success`) and their exact error messages are
  unchanged -- only how `ciRun` is obtained changed.

## Known Gaps

- This fix has not yet been exercised live against a real >30-check-run
  commit through GitHub Actions -- only locally, against synthetic
  unit-test fixtures. Live confirmation happens when this PR's own commits
  accumulate check-runs.
- Does not touch `scripts/ops/executor-result-validate.ts` (check-name
  resolution) or any other part of the validator's logic -- narrowly scoped
  to the pagination/selection defect only, per the task's explicit scope.

## ASSERTIONS:

- [x] `checks.listForRef` is called through full pagination (`github.paginate`, `per_page: 100`), not a single unpaginated call
- [x] Pagination is not capped at 100 and stopped -- `github.paginate` walks every page GitHub returns
- [x] A valid `verify` check-run appearing after the first 30 results is found (regression test, synthetic 30-item noise prefix)
- [x] A valid `verify` check-run appearing after the first 100 results is found (regression test, synthetic 150-item noise prefix)
- [x] A same-named `verify` check-run from a different app (`app.slug !== 'github-actions'`) is ignored (regression test)
- [x] Among duplicate `github-actions` `verify` check-runs, the newest (highest `id`) governs regardless of array/insertion order (regression test, both orderings)
- [x] A missing, incomplete (`status !== 'completed'`), or failed (`conclusion !== 'success'`) latest run still fails closed -- the newest matching run is always returned, never silently superseded by an older successful one (regression test, both incomplete and failed cases)
- [x] The existing exact-head requirement and the three original failure messages (`not found` / `not completed` / `conclusion is X`) are structurally unchanged
- [x] Comparison against the then-current `main` confirmed the defect was pre-existing and not introduced by the unrelated lane where it was observed
- [x] No product/runtime code touched; `git diff --stat origin/main..HEAD` shows only the workflow file, the new selection module, the lane's own manifest/sync/proof files, and the test file
- [x] Does not modify the unrelated lane where the defect was observed
- [x] `pnpm verify` PASS (full local run, including `pnpm test:db` against live Supabase)
- [x] `r-level-check` PASS, no artifacts required for this diff (pure ops-tooling/CI-workflow change, matches no R1-R5 rule path)

## EVIDENCE:

```text
$ npx tsx --test scripts/ops/workflow-hardening.test.ts
...
# Subtest: UTV2-1573: executor-result-validator.yml paginates check-runs instead of a single unpaginated call
ok 22 - UTV2-1573: executor-result-validator.yml paginates check-runs instead of a single unpaginated call
# Subtest: UTV2-1573: selectLatestVerifyCheckRun finds a valid run past the first page boundaries
ok 23 - UTV2-1573: selectLatestVerifyCheckRun finds a valid run past the first page boundaries
# Subtest: UTV2-1573: selectLatestVerifyCheckRun ignores a same-named check from a different app
ok 24 - UTV2-1573: selectLatestVerifyCheckRun ignores a same-named check from a different app
# Subtest: UTV2-1573: selectLatestVerifyCheckRun picks the newest of duplicate github-actions verify runs
ok 25 - UTV2-1573: selectLatestVerifyCheckRun picks the newest of duplicate github-actions verify runs
# Subtest: UTV2-1573: selectLatestVerifyCheckRun fails closed -- missing, incomplete, or failed latest run is never silently bypassed
ok 26 - UTV2-1573: selectLatestVerifyCheckRun fails closed -- missing, incomplete, or failed latest run is never silently bypassed
...
1..39
# tests 39
# pass 39
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```

```text
$ pnpm verify
...
# tests (all suites)
# fail 0
(zero "not ok" lines across the entire run, including pnpm test:db against live Supabase)
```
