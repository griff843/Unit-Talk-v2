# PROOF: UTV2-1592
MERGE_SHA: b567c2132da204f59235fe6197361cb3cc63b17c

## Summary

UTV2-1592 adds a mandatory pre-merge authorization gate to
`scripts/ops/merge-wrapper.ts`'s `pr-merge` operation. Before the actual
`gh pr merge` command is allowed to run, `scripts/ops/pre-merge-authorization.ts`
re-fetches the PR's current live head SHA and re-evaluates required GitHub
checks (exact-identity match on the `Merge Gate` custom check, never its
`Merge Gate Evaluator` job) plus the latest `pm-verdict/v1` comment against
that live head, via `evaluateRequiredChecksWithHeadFallback` and
`merge-gate-verdict.cjs`'s `parseVerdict`/`validateT1Verdicts` (reused, not
reimplemented). The admin-merge-gate-bypass path is hard-disabled here since
it must never apply pre-merge. If authorization is rejected, the merge
command is never invoked.

## ASSERTIONS:

- [x] `truth-check-lib.ts` exports (`fetchRequiredChecks`, `parsePullRequestUrl`,
      `fetchGitHubPullRequest`, `fetchGitHubPullRequestComments`, `githubHeaders`)
      are additive only — `pnpm test` for `truth-check-lib.test.ts` stayed at
      63/63 passing before and after the export change, confirming no behavior
      change.
- [x] `evaluatePreMergeAuthorization` authorizes the merge only when required
      checks pass with exact context identity on the live head AND the latest
      `pm-verdict/v1` comment is schema-valid and bound to that same live head.
- [x] A required check missing entirely (not failing — absent, `matched: false`,
      `source: null`) rejects the merge, reproducing a prior lane's incident as
      a fixture (`pre-merge-authorization.test.ts`).
- [x] `Merge Gate Evaluator` succeeding is never accepted as a substitute for
      the `Merge Gate` check itself — proven as an explicit fixture test.
- [x] A malformed PM verdict (missing `Head SHA:`) and a schema-valid verdict
      bound to a stale head SHA both reject the merge.
- [x] The head-SHA fetch is proven fresh per call (race-prevention test: a
      mock fetcher returning different values on sequential calls confirms the
      latest value is what gets evaluated) and is structured to run last,
      immediately before the decision is returned.
- [x] `merge-wrapper.ts`'s `pr-merge` branch never invokes the merge runner
      when authorization fails, and does invoke it when authorization
      succeeds — asserted via the runner mock's call count in both directions.
- [x] The gate does not apply to `pr-update-branch` or `main-sync` operations.
- [x] `pnpm verify` is green on this branch (lint, type-check, build, full
      test suite, `pnpm test:db` against live Supabase).
- [x] `scripts/ci/r-level-check.ts` reports PASS with no R-level artifacts
      required for this diff.

## EVIDENCE:

### pnpm test — new/changed ops test files

```
=== scripts/ops/pre-merge-authorization.test.ts (new) ===
1..9
# tests 9
# suites 0
# pass 9
# fail 0
# cancelled 0
# skipped 0
# todo 0

=== scripts/ops/merge-wrapper.test.ts ===
1..13
# tests 13
# suites 0
# pass 13
# fail 0
# cancelled 0
# skipped 0
# todo 0

=== scripts/ops/ops-merge-wrapper.test.ts ===
1..35
# tests 35
# suites 0
# pass 35
# fail 0
# cancelled 0
# skipped 0
# todo 0

=== scripts/ops/truth-check-lib.test.ts ===
1..63
# tests 63
# suites 0
# pass 63
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### pnpm test:db (live Supabase — command executed for real)

```
> @unit-talk/v2@0.1.0 test:db /home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1592-pre-merge-authorization
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 17754.987542
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 15334.065204
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 16631.587261
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 16565.742289
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 809.07438
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 16293.563103
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 16231.200361
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 100244.333487
```

### r-level-check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 9
Rules matched: (none) — no R-level artifacts required for this diff
```

## Verification

- [x] `pnpm lint`: PASS — 0 errors, 0 warnings
- [x] `pnpm type-check`: PASS — 0 TS errors (`scripts/ops/*` is outside the
      `tsc -b tsconfig.json` project-reference graph; runtime behavior is
      covered by `pnpm test` above)
- [x] `pnpm build`: PASS
- [x] `pnpm test`: PASS — full suite green, no failures anywhere
- [x] `pnpm verify`: PASS — `verify:static` (env:check, lint, type-check,
      build, test, verify:commands) and `test:live-db` (`pnpm test:db` +
      `pnpm test:t1-proof:live`) both green
- [x] `scripts/ci/r-level-check.ts`: PASS — no R-level artifacts required

## SHA Binding
Head SHA: b567c2132da204f59235fe6197361cb3cc63b17c
Merge SHA: b567c2132da204f59235fe6197361cb3cc63b17c
