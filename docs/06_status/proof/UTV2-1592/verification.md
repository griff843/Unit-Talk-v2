# PROOF: UTV2-1592
MERGE_SHA: c26646b9215cea2bddaa7473f7ebb24c74709924

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

**This amendment (final head c26646b9) is a PM changes-requested revision of the
originally reviewed head (b567c213 / PR #1311).** PM review of that head
found three release-blocking gaps, all closed here:

1. **Merge-train bypass** — `runMergeTrainEntry` (ops-merge-wrapper.ts)
   built and executed its own `gh pr merge` command directly, never calling
   the authorization gate at all. Fix: both `runMergeWrapper`'s direct
   `pr-merge` operation and `runMergeTrainEntry` now call a single new
   exported primitive, `runAuthorizedPrMerge` (merge-wrapper.ts) — the sole
   path in the codebase allowed to execute a `pr-merge` command. It runs
   `runPreMergeAuthorizationCheck` first and only invokes the merge command
   when that returns `authorized: true`.
2. **Comment pagination gap** — `fetchGitHubPullRequestComments`
   (truth-check-lib.ts) only requested page 1 (`per_page=100`), so a PR
   with more than 100 comments could silently drop a `pm-verdict/v1`
   comment past the 100th. Fix: it now paginates via the same
   `fetchAllPages` helper `fetchCommitChecks` already uses for
   statuses/check-runs, feeding both `pre-merge-authorization.ts`'s
   verdict lookup and `truth-check-lib.ts`'s own H4 gate.
3. **Exit-code trust gap** — `runPreMergeAuthorizationCheck` accepted an
   `authorized: true` JSON receipt from the authorization subprocess without
   checking that the subprocess itself exited 0. Fix: it now requires
   `run.status === 0` in addition to a valid `authorized: true` receipt,
   and the subprocess call carries a bounded 30s timeout
   (`spawnSync`'s own `timeout` option, whose ETIMEDOUT firing already
   surfaces as a fail-closed `run.error`).

**A second fix-up commit (c26646b9)** closed two further gaps the automated
PR review packet (`scripts/ops/pr-review-packet.ts`) surfaced once the
`tier:T1` label was applied to this PR (its earlier run against the
originally reviewed head short-circuited before the label existed, so
neither had been caught):

4. **Missing test wiring** — `scripts/ops/pre-merge-authorization.test.ts`'s
   9 tests were never added to `package.json`'s `test:ops` script (an
   explicit file list, not a glob), so `pnpm test`/`pnpm verify` had never
   actually run them despite the file existing since the original commit.
   Fixed by adding the path to `test:ops`.
5. **Proof-directory scope-declaration gap** — `verification.md` and
   `.gitkeep` under `docs/06_status/proof/UTV2-1592/` were never declared in
   the lane manifest's `expected_proof_paths` (only `evidence.json` was),
   so the review packet's scope check flagged them as scope bleed. Fixed by
   adding both paths to `expected_proof_paths`.

## ASSERTIONS:

- [x] `truth-check-lib.ts` exports (`fetchRequiredChecks`, `parsePullRequestUrl`,
      `fetchGitHubPullRequest`, `fetchGitHubPullRequestComments`, `githubHeaders`)
      are additive only.
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
- [x] The head-SHA fetch is proven fresh per call (race-prevention test) and
      is structured to run last, immediately before the decision is returned.
- [x] `merge-wrapper.ts`'s `pr-merge` branch never invokes the merge runner
      when authorization fails, and does invoke it when authorization
      succeeds — asserted via the runner mock's call count in both directions.
- [x] The gate does not apply to `pr-update-branch` or `main-sync` operations.
- [x] **NEW** — merge-train's per-candidate merge step (`runMergeTrainEntry`)
      now runs the identical authorization gate before every candidate's
      merge, not just the first: `runAuthorizedPrMerge` is invoked once per
      candidate, with each authorization call immediately preceding, and
      bound to the same PR number as, its own merge call.
- [x] **NEW** — a merge-train candidate whose authorization is denied never
      has its merge runner invoked, and the drain stops (subsequent
      candidates report `skipped_after_failure`) exactly as an update-branch
      or CI failure already does.
- [x] **NEW** — `fetchGitHubPullRequestComments` paginates past 100 comments;
      a comment on a synthetic page 2 (the 101st) is returned and visible to
      verdict selection.
- [x] **NEW** — an `authorized: true` receipt from a subprocess that exited
      non-zero is refused, not trusted.
- [x] **NEW** — a subprocess timeout/signal (`run.error` set), malformed JSON
      stdout, and empty/missing stdout with a null exit status all fail
      closed independently.
- [x] **NEW** — `runPreMergeAuthorizationCheck` passes a bounded (>0)
      `timeoutMs` to the runner on every call.
- [x] **NEW** — a repo-wide audit (`grep -rn "buildMergeCommand("`) confirms
      exactly two real execution call sites for a `pr-merge` command exist
      (runMergeWrapper and runMergeTrainEntry), both now routed through
      `runAuthorizedPrMerge`; a structural regression test
      (`merge-wrapper.test.ts`) asserts `ops-merge-wrapper.ts` no longer
      constructs its own `operation: 'pr-merge'` command and that
      `runAuthorizedPrMerge(` appears exactly twice in `merge-wrapper.ts`
      (its declaration + the one call site inside `runMergeWrapper`).
- [x] Later CHANGES_REQUIRED beats earlier APPROVED, and later valid APPROVED
      beats earlier CHANGES_REQUIRED — both already covered independently by
      `merge-gate-verdict.test.ts` (`validateT1Verdicts`'s
      "authorized verdicts, latest wins" selection, unchanged by this
      amendment; the pagination fix is what guarantees the *complete* set of
      verdicts reaches that selection in the first place).
- [x] All pre-existing lock-release/deferred-merge assertions
      (`merge-wrapper.test.ts`'s lock-held/lock-release/deferred-record tests,
      `ops-merge-wrapper.test.ts`'s merge-train happy-path/mid-train-failure/
      dry-run/timing tests) pass unmodified — the only change to their
      shared fixture (`buildFakeRunner`) is an added branch that answers the
      new authorization subprocess call; no existing assertion changed.
- [x] **NEW** — `scripts/ops/pre-merge-authorization.test.ts`'s 9 tests are
      now wired into `package.json`'s `test:ops` script (they were never run
      by `pnpm test`/`pnpm verify` before this fix, despite the file
      existing since the original commit); `pnpm test:ops` totals 1242/1242
      passing with it included.
- [x] **NEW** — `docs/06_status/proof/UTV2-1592/verification.md` and
      `.gitkeep` are now declared in the lane manifest's
      `expected_proof_paths`, closing a scope-bleed false positive the
      automated review packet raised once `tier:T1` was applied.
- [x] `pnpm verify:parallel` is green on this commit (lint + type-check in
      parallel, then build + full test suite).
- [x] `pnpm test:db` is green against live Supabase (7/7).
- [x] `scripts/ci/r-level-check.ts` reports PASS with no R-level artifacts
      required for this diff (14 changed files).
- [x] `scripts/ops/pr-review-packet.ts --issue UTV2-1592 --pr 1311 --json`
      run locally reports `verdict: PASS` with all 6 structural checks
      (`scope`, `test_wiring`, `dropped_tests`, `sync_metadata`, `r_level`,
      `proof`) at PASS.

## EVIDENCE:

### pnpm test — touched ops test files (final totals on c26646b9)

```
=== scripts/ops/merge-wrapper.test.ts ===
1..21
# tests 21
# suites 0
# pass 21
# fail 0
# cancelled 0
# skipped 0
# todo 0

=== scripts/ops/ops-merge-wrapper.test.ts ===
1..37
# tests 37
# suites 0
# pass 37
# fail 0
# cancelled 0
# skipped 0
# todo 0

=== scripts/ops/truth-check-lib.test.ts ===
1..64
# tests 64
# suites 0
# pass 64
# fail 0
# cancelled 0
# skipped 0
# todo 0

=== scripts/ops/pre-merge-authorization.test.ts ===
1..9
# tests 9
# suites 0
# pass 9
# fail 0
# cancelled 0
# skipped 0
# todo 0

=== scripts/ops/merge-gate-verdict.test.ts (unmodified this amendment) ===
1..19
# tests 19
# suites 0
# pass 19
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
  duration_ms: 18415.089231
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 15806.172014
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 15746.167464
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 15879.87138
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 987.487138
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 16777.682333
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 17925.094248
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
# duration_ms 102214.603739
```

### r-level-check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 14
Rules matched: (none) — no R-level artifacts required for this diff
```

### Repo-wide buildMergeCommand() audit (required test #12)

```
$ grep -rn "buildMergeCommand(" --include="*.ts" scripts/ apps/ packages/
scripts/ops/ops-merge-wrapper.ts:105:      return buildMergeCommand({ ...input, operation } as MergeWrapperInput);   # buildExtendedCommand default case — only reachable for git-merge-main/git-rebase-main, never pr-merge
scripts/ops/ops-merge-wrapper.ts:158:  const mainSyncPullCommand = buildMergeCommand({ ...bridgedInput, operation: 'main-sync' });   # comparison-only, main-sync, not executed as pr-merge
scripts/ops/ops-merge-wrapper.ts:524:  const updateBranchCommand = buildMergeCommand({ operation: 'pr-update-branch', ... });   # not a merge mutation
scripts/ops/merge-wrapper.ts:290:export function buildMergeCommand(input: MergeWrapperInput): MergeCommand {   # definition
scripts/ops/merge-wrapper.ts:346:  const command = buildMergeCommand(input);   # runMergeWrapper — built for all ops, executed via runAuthorizedPrMerge for pr-merge (see below)
scripts/ops/merge-wrapper.test.ts: 3 call sites — pure buildMergeCommand() unit tests, no execution
```

The one prior direct pr-merge execution site inside `runMergeTrainEntry`
(`buildMergeCommand({ operation: 'pr-merge', ... })` followed immediately by
`deps.runner(mergeCommand.command, ...)`) has been removed; `runAuthorizedPrMerge`
now builds and (conditionally) executes that command internally. A structural
regression test (`merge-wrapper.test.ts`, "buildMergeCommand({ operation:
\"pr-merge\" }) is never executed anywhere outside runAuthorizedPrMerge")
guards against a future direct execution path being reintroduced.

## Verification

- [x] `pnpm lint`: PASS — 0 errors, 0 warnings
- [x] `pnpm type-check`: PASS — 0 TS errors (`scripts/ops/*` remains outside
      the `tsc -b tsconfig.json` project-reference graph, as before this
      amendment; runtime behavior is covered by `pnpm test` above, which
      exercises every branch touched by this change)
- [x] `pnpm build`: PASS
- [x] `pnpm test`: PASS — full suite green, no failures anywhere
- [x] `pnpm verify:parallel`: PASS — lint + type-check in parallel, then
      build + full test suite
- [x] `pnpm test:db`: PASS — 7/7 against live Supabase (see above)
- [x] `scripts/ci/r-level-check.ts`: PASS — no R-level artifacts required
- [x] `scripts/ops/pr-review-packet.ts`: PASS — verdict PASS, all 6 checks
      PASS (scope, test_wiring, dropped_tests, sync_metadata, r_level, proof)

## SHA Binding
Head SHA: c26646b9215cea2bddaa7473f7ebb24c74709924
Merge SHA: c26646b9215cea2bddaa7473f7ebb24c74709924
