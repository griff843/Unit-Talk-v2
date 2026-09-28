# Diff summary: WORK-2026092706

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | The `Writable DB proof (staging only)` job joins job-level concurrency group `staging-ci-db`, `cancel-in-progress: false`, with a comment giving the reason and the trade-off. |
| `.github/workflows/staging-db-proof.yml` | Same for its resetting job. |
| `scripts/ops/workflow-hardening.test.ts` | New test: every job that runs `seed-staging-fixtures.ts` is in `staging-ci-db`, and no other job is. |
| `.ops/work/WORK-2026092706.md` | Repo-owned work order (T1 by mechanical floor). |

`proof-gate.yml`, `proof-regression.yml` and `t1-proof-gate.yml` are declared in the lane scope
and deliberately left unchanged (see verification.md, Evidence 2).

## SHA Binding

Merge SHA: e8482f4e013487fd2f5673d1ec4b83d4982aed02
PR: https://github.com/griff843/Unit-Talk-v2/pull/1671
