# PROOF: WORK-2026103002

MERGE_SHA: pending merge

Issue: WORK-2026103002
Tier: T1
Lane type: governance
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] On `push`, `wait-for-merge-ci` finishes only once every `ci.yml` run for the merge SHA has completed. The test runs the step's script as written against a stubbed `gh` that answers running, running, running and then completed, and the step exits 0 after the fourth call. An absent run followed by a running one keeps it waiting (`closeout waits for merge-SHA CI to complete before the closeout gates run`).
- [x] The wait never blocks a closeout indefinitely. With no run past the grace period, with a run stuck past the deadline, or with an unreadable API until the deadline, it exits 0 and prints a warning, leaving the decision to the closeout gates (`closeout wait never blocks forever: it proceeds and leaves the decision to the gates`).
- [x] The wait job is push-only and holds no concurrency group. `merge-closeout-mutex` lives on the `lane-close` job, not on the workflow or the wait job. `lane-close` `needs` the wait and runs under `!cancelled()`, so a `workflow_dispatch` replay, which skips the wait, still runs it. The wait's `run:` script has no `${{` substitution (`closeout wait is push-only, holds no mutex and cannot skip the closeout`).
- [x] The UTV2-1713 serialization test reads the job-level mutex and still holds.
- [x] Unchanged: every closeout gate (G6 included), the closeout steps themselves, Merge Gate, the required checks, lane admission and `ci.yml`.

## EVIDENCE:

Why. Push closeouts that failed G6 because they started while `ci.yml` on the merge SHA was still running, read from each run's log (`gh run view <id> --log`) and from `gh run list --workflow ci.yml --branch main`:

```text
merge      push closeout (G6 FAIL)   ci.yml on merge SHA                 replay
cd350ef8b  40987061159  01:38        01:38 -> 01:52  success             40988392742 success
b4ab31a3a  40994374430  02:54        02:54 -> 03:11  success             40995965707 success
104185674  41004630969  04:45        04:45 -> 04:55+ success             41009442305 success
```

Each failed with `[FAIL] G6 lane deferred its T1 live-DB precondition to CI, and the staging receipt is not green at merge SHA <sha>. Missing or failing: verify, Writable DB proof (staging only)`, and each replay after CI finished closed the lane.

Mutation checks. Each mutation was applied alone to `.github/workflows/post-merge-lane-close.yml`, then `scripts/ops/workflow-hardening.test.ts` was rerun (`--test-name-pattern "closeout|linear-auto-close"`) and the file was restored. They were run in a scratch checkout whose two files are the same blobs as on `f1c0f0c46` (workflow `a27b6416a2932023ccad4bdd7c2c8b146eb83e62`, test `335f7a4858a3b3a318a66e55470a9366f8c7ef03`, compared with `git rev-parse HEAD:<path>` in both):

```text
M1 completion judged by any run instead of all runs   -> fail=1
M2 no grace for an absent run                         -> fail=1
M3 unreadable API treated as completed                -> fail=1
M4 lane-close no longer needs the wait                -> fail=1
M5 mutex placed on the wait job                       -> fail=1
M6 !cancelled() removed from lane-close               -> fail=1
```

The live behavior on `main` is exercised by the first push-triggered closeout after this merges. That is this lane's own closeout, which must close without a replay.

## Verification

Run on `f1c0f0c463eac75b393f1a3b3a96fdacf7da24ce`:

- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts`: `# tests 98`, `# pass 98`, `# fail 0`, `# skipped 0`.
- [x] `pnpm test`: exit 0. Summed node:test totals across all files: `# tests 7701`, `# pass 7688`, `# fail 0`, `# skipped 13`. A first run in the fresh worktree, before any package build, failed command-center imports of unbuilt `packages/*/dist`. It was rerun after `pnpm type-check` had built them.
- [x] `pnpm type-check`: exit 0.
- [x] `pnpm exec eslint scripts/ops/workflow-hardening.test.ts`: exit 0. Repo-wide `pnpm lint` runs in CI.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, no R-level artifacts required.
- [x] `pnpm ops:preflight WORK-2026103002 --tier T1 --branch claude/work-2026103002-closeout-waits-for-ci --refresh`: `VERDICT: PASS (42 checks)`. PT1 was BLOCKED_BY_CONTAINMENT; that outcome is admitted under the ratified route B in `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md`.
- [ ] `pnpm verify` in CI on the PR head: pending. CI `verify` is the verification of record.
- [ ] `pnpm test:db`: deferred to the protected `staging-ci` environment inside the required `verify` check. This lane accessed no database.

Runtime: this lane changes a GitHub Actions workflow; it has no service runtime surface.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1807
Execution SHA: f1c0f0c463eac75b393f1a3b3a96fdacf7da24ce
