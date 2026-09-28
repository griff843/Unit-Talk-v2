# PROOF: WORK-2026092706

MERGE_SHA: e8482f4e013487fd2f5673d1ec4b83d4982aed02

Issue: WORK-2026092706
Tier: T1
Lane type: governance
Branch: claude/work-2026092706-staging-ci-serialize
result: pass

## ASSERTIONS:

- [x] Every job that runs `scripts/ci/seed-staging-fixtures.ts` declares job-level
      `concurrency: { group: staging-ci-db, cancel-in-progress: false }`. Today those are the
      `Writable DB proof (staging only)` jobs in `ci.yml` and `staging-db-proof.yml`.
- [x] No other job joins the group. `proof-gate.yml`, `proof-regression.yml` and
      `t1-proof-gate.yml` are unchanged from `main`.
- [x] `scripts/ops/workflow-hardening.test.ts` enforces both rules over every workflow. Test:
      "every job that runs the staging seed reset, and only those, is serialized in staging-ci-db".
- [x] **Runtime:** two resetting jobs from different workflows ran one at a time on GitHub, with
      no cancellation (Evidence 1).
- [x] Unchanged: workflow-level per-PR `cancel-in-progress`, every required-check and job name,
      credential bindings, seed and reset behaviour, merge-gate inputs and branch protection.

## EVIDENCE:

### 1. Runtime serialization on GitHub Actions, head d02d3a047

The PR's `CI` run and a `Staging DB Proof` dispatch on the same branch were started 11 s apart:

```
run 36337320725 (CI, pull_request)          Writable DB proof  created 17:32:27Z  started 17:32:30Z  completed 17:41:53Z  success
run 36337333815 (Staging DB Proof, dispatch) Writable DB proof  created 17:32:41Z  pending ...        started 17:41:55Z
```

The dispatched job stayed `pending` for 9 min 14 s and started 2 s after the first job completed.
Neither job was cancelled. `verify` on run 36337320725 then passed, and verified the CI-produced
DB proof receipt for that run and attempt.

### 2. The first revision's defect, measured, and why the group is restricted

Revision b2d2ab854 grouped every `staging-ci` job. On this PR, run 36336740857's staging job was
cancelled after 9 s:

```
Canceling since a higher priority waiting request for staging-ci-db exists
```

`proof-gate.yml`'s T1 Proof Gate, fired by the same `pull_request` event, had joined the group. That
job binds `staging-ci` but does not run the reset. GitHub keeps one pending job per group, so it
displaced `verify`'s pending staging job. Only resetting jobs now join.

### 3. The defect this lane repairs (measured 2026-09-27)

Run 36331464602, on another PR:

- Attempt 1 failed at 16:06:02, 25 s after another PR's staging job started.
- Attempt 2 failed at 16:23:29, 45 s after `main`'s push run started its staging job, which logged
  `reset system_runs: 6 row(s) deleted`.

Both failed with `Failed to complete system run: Cannot coerce the result to a single JSON object`.

### 4. Mutation drills

```
M1: staging-db-proof.yml group renamed to staging-db-proof-solo (a resetter left out)
not ok 74 - every job that runs the staging seed reset, and only those, is serialized in staging-ci-db
# fail 1
M2: proof-gate.yml t1-proof joins staging-ci-db (a non-resetter joins)
not ok 74 - every job that runs the staging seed reset, and only those, is serialized in staging-ci-db
# fail 1
```

Both files were restored from a copy after each drill.

### 5. Test DB

`pnpm test:db` runs inside the required `verify` context. `Writable DB proof (staging only)` passed
on run 36337320725, and `verify` verified its receipt with `scripts/ci/verify-db-proof-receipt.ts`.
Staging only. No production credential is used, and no production write is made.

## Verification

```
pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts    # tests 74, pass 74, fail 0, skipped 0
pnpm exec eslint scripts/ops/workflow-hardening.test.ts        # exit 0
pnpm type-check                                                # exit 0 (preflight PB1)
pnpm test                                                      # pass (preflight PB2, full suite)
pnpm verify                                                    # required `verify` job: success on run 36337320725, head d02d3a047
pnpm test:db                                                   # inside `verify`: Writable DB proof (staging only) success, receipt verified
pnpm exec tsx scripts/ci/r-level-check.ts --base 62906b035 --head d02d3a047   # Verdict: PASS, no R-level artifacts required
```

Known residual, out of scope: a third resetting job arriving while one runs and one is pending
cancels the pending one. That `verify` fails visibly and is rerun; nothing is corrupted.
Non-resetting staging writers (the T1 Proof Gate's `ci:db-smoke`, `proof-regression`) are not
serialized. None of them resets tables.

## Merge SHA Binding

Merge SHA: `e8482f4e013487fd2f5673d1ec4b83d4982aed02`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1671
