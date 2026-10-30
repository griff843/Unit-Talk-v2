# PROOF: WORK-2026103003

MERGE_SHA: 985fcdb4c3fa5a6df8b49c8ce3df6471666c7938

Issue: WORK-2026103003
Tier: T1
Lane type: governance
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] `lane-close`'s single `actions/checkout` step uses `ref: ${{ github.ref }}`. On a push the job therefore checks out the tip of `main` when it starts, after the CI wait, not the merge SHA (`closeout checks out the branch tip after the wait, not the merge SHA`).
- [x] Merge identity is unchanged. `Resolve merge SHA` still requires the PR's merge commit to equal the push SHA, proof binding still binds that SHA, and G3 still requires it on `main` first-parent history. None of those steps was edited.
- [x] Unchanged: every closeout gate, the guarded push and its refusal to rebase, the wait job, Merge Gate, the required checks, lane admission and `ci.yml`.

## EVIDENCE:

Why. #1807's own push closeout, run 41055315520, read from `gh run view 41055315520 --log` and `gh api repos/griff843/Unit-Talk-v2/actions/runs/41055315520/jobs`:

```text
Wait for merge-SHA CI: success 2026-10-30T12:26:13Z -> 2026-10-30T12:51:42Z
Auto-close merged lane: failure 2026-10-30T12:51:44Z -> 2026-10-30T12:52:17Z
main ci 41055315588 ee8c4bfff completed success 2026-10-30T12:51:36Z
[PASS] G6 deferred T1 live-DB precondition satisfied at merge SHA ee8c4bfff02a931637dff8c20ef333066339bd26: verify and Writable DB proof (staging only) are both green
##[notice]Lane closeout PASSED for WORK-2026103002
11 Run lane closeout (hard-gate): success
16 Commit and push gate-evaluated closeout state: failure
 ! [rejected]            main -> main (non-fast-forward)
##[error]Main advanced while the closeout merge mutex was held. Refusing to rebase or retry; main remains unmutated. Re-run this workflow from a fresh dispatch.
```

Main advanced during the wait, from `git log origin/main --format='%h %cI %an %s'`:

```text
773b9f309 2026-10-30T12:28:05Z github-actions[bot] ops(readiness): refresh ledger [skip ci]
ee8c4bfff 2026-10-30T08:26:07-04:00 griff843 WORK-2026103002: push-triggered closeout waits for merge-SHA CI (#1807)
```

Replay 41058773012 (`workflow_dispatch`, `issue_id=WORK-2026103002`) succeeded and pushed `30dfda5bc`.

Mutation checks. Each mutation was applied alone to `.github/workflows/post-merge-lane-close.yml`, restored from a copy whose blob equals the committed one (`git hash-object` = `e9954c8837c497992e83bb5e68400ebea17fbc57`, test file `f2053c72560a75b168b8c71d83dec4460bb90fbf`), and `pnpm exec tsx --test --test-name-pattern "closeout" scripts/ops/workflow-hardening.test.ts` was rerun:

```text
M1 ref line removed            -> # fail 1
M2 ref: ${{ github.sha }}      -> # fail 1
M3 ref: main (literal)         -> # fail 1
restored                       -> # fail 0
```

M1's first attempt used a regex `grep -v` that matched nothing, so that run mutated nothing and reported `# fail 0`. It was redone with `grep -vF`; `diff` confirmed the line was removed, and the run then reported `# fail 1`.

## Verification

Run on `957e02580e8fae76fcc4a7f657def78bb4cd3247`:

- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts`: `# tests 99`, `# pass 99`, `# fail 0`, `# skipped 0`.
- [x] `pnpm exec tsx --test scripts/ops/lane-close.test.ts`: `# tests 194`, `# pass 194`, `# fail 0`, `# skipped 0`.
- [x] `pnpm exec tsx --test scripts/ops/proof-generate.test.ts`: `# tests 108`, `# pass 108`, `# fail 0`, `# skipped 0`.
- [x] `pnpm test`: exit 0. Summed node:test totals across all files: `# tests 7726`, `# pass 7713`, `# fail 0`, `# skipped 13`.
- [x] `pnpm type-check`: exit 0.
- [x] `pnpm exec eslint scripts/ops/workflow-hardening.test.ts`: exit 0. Repo-wide `pnpm lint` runs in CI.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`.
- [x] `pnpm ops:preflight WORK-2026103003 --tier T1 --branch claude/work-2026103003-closeout-checkout-main --lane-type governance --refresh`: `VERDICT: PASS (42 checks)`. PT1 was BLOCKED_BY_CONTAINMENT; that outcome is admitted under the ratified route B in `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md`.
- [ ] `pnpm verify` in CI on the PR head: pending. CI `verify` is the verification of record.
- [ ] `pnpm test:db`: deferred to the protected `staging-ci` environment inside the required `verify` check. This lane accessed no database.

Runtime: this lane changes a GitHub Actions workflow; it has no service runtime surface. The live check is the first push closeout after merge during which `main` advances.

## Merge SHA Binding

Merge SHA: 985fcdb4c3fa5a6df8b49c8ce3df6471666c7938
PR: https://github.com/griff843/Unit-Talk-v2/pull/1809
Execution SHA: 957e02580e8fae76fcc4a7f657def78bb4cd3247
