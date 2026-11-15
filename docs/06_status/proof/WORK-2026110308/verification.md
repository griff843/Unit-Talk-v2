# PROOF: WORK-2026110308

MERGE_SHA: 1ba31df783f8e7ca36a27729b79be6a9c7461469

Issue: WORK-2026110308
Tier: T1
Lane type: hygiene
result: local_pass

## ASSERTIONS:

- [x] The four jobs that run `playwright install` use `runs-on: ubuntu-24.04`:
  - `qa-fast.yml:14`
  - `qa-experience-regression.yml:16`
  - `post-merge-qa-gate.yml:41`
  - `staging-db-proof.yml:47` (the `staging-db-proof` job, which installs at `:175`)
- [x] No other workflow line changed. The `git diff -U0` of `.github/` shows exactly four `-    runs-on: ubuntu-latest` / `+    runs-on: ubuntu-24.04` pairs.
- [x] The `proof-auditor` job of `staging-db-proof.yml` (at `:205`) does not install Playwright and is unchanged.
- [x] No change to `ci.yml`, `merge-gate.yml`, `proof-gate.yml`, any required check, any step, trigger, permission, environment, secret, concurrency group or Playwright version.

## EVIDENCE:

Cause, read from qa-fast run 41692903141 (2026-11-03): `Image: ubuntu-26.04`, version `20261025.179.1`. The install step failed with "Playwright does not support chromium on ubuntu26.04-x64". The repo pins `"playwright": "1.58.2"` (`package.json:218`). The last green qa-fast runs were 41518733002 and 41515869243 on 2026-11-02.

Diff, from `git diff -U0` on `.github/`:

```text
-    runs-on: ubuntu-latest
+    runs-on: ubuntu-24.04
-    runs-on: ubuntu-latest
+    runs-on: ubuntu-24.04
-    runs-on: ubuntu-latest
+    runs-on: ubuntu-24.04
-    runs-on: ubuntu-latest
+    runs-on: ubuntu-24.04
```

Each of the four files parses with `yaml.parse` (`yaml ok qa-fast`, `yaml ok qa-experience-regression`, `yaml ok post-merge-qa-gate`, `yaml ok staging-db-proof`).

## Verification

Run on `e13612ce77a11210d5f93ba957b9b2d92c34214a`:

- [x] `pnpm build`: `pnpm build exit=0`.
- [x] `pnpm test`: `pnpm test exit=0`. The `# tests`, `# pass`, `# fail` and `# skipped` lines summed across the run give tests 7822, pass 7809, fail 0, skipped 13.
  - An earlier run in this worktree, before `pnpm build`, exited 1 with `Cannot find module '../../../../../packages/config/dist/env.js'`. That was an unbuilt worktree, not this diff; the run above is after the build.
- [x] The workflow-reading suites:
  - `npx tsx --test scripts/ci/isolated-proof-attestation.test.ts`: `# tests 36`, `# pass 36`, `# fail 0`, `# skipped 0`.
  - `npx tsx --test scripts/ci/staging-path-enforcement.test.ts`: `# tests 53`, `# pass 53`, `# fail 0`, `# skipped 0`.
  - `npx tsx --test scripts/ci/verify-db-proof-receipt.test.ts`: `# tests 8`, `# pass 8`, `# fail 0`, `# skipped 0`.
  - `npx tsx --test scripts/ci/workflow-production-credential-guard.test.ts`: `# tests 37`, `# pass 37`, `# fail 0`, `# skipped 0`.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, `Rules matched: (none) — no R-level artifacts required for this diff`.
- [ ] `pnpm verify` and `pnpm test:db` run in protected CI on the PR head, which produces the staging DB receipt. `pnpm verify` cannot exit 0 locally, because `ci:assert-staging` requires the CI environment.

## Runtime Verification

This lane changes only the runner image of four jobs. None of the four can run on this PR's head:

- `qa-fast.yml` and `qa-experience-regression.yml` trigger only on `pull_request` paths under `apps/command-center/**`, `apps/smart-form/**`, `apps/qa-agent/**` or `apps/operator-web/**`, and this PR touches none of them.
- `post-merge-qa-gate.yml` runs on push to `main`.
- `staging-db-proof.yml` is `workflow_dispatch`-only.

So no run of the pinned jobs exists before merge, and none is claimed.

The evidence that `ubuntu-24.04` with this Playwright works comes from the last green qa-fast runs, from `gh run view <id> --log`:

- Run 41518733002 at `1ce1103d6` (2026-11-02): `Image: ubuntu-24.04`, `Version: 20261021.618`; step `pnpm --filter @unit-talk/qa-agent exec playwright install chromium --with-deps` logged `Chrome for Testing 145.0.7632.6 (playwright chromium v1208) downloaded`.
- Run 41515869243 at `c0a35a0bf` (2026-11-02): same image, same step, same download line.

At `1ce1103d6`, `package.json:218` is `"playwright": "1.58.2"` and `apps/qa-agent/package.json:13` is `"playwright": "^1.50.0"`, the same as on this branch. Those runs are on an older commit, not this head.

The first run of a pinned job after merge (the next PR touching those app paths, or the next push to `main` for `post-merge-qa-gate.yml`) is the direct proof. It is not proven by this PR.

`staging-db-proof.yml` is `workflow_dispatch`-only. Its job is also named "Writable DB proof (staging only)", like the job in `ci.yml`, so any run of it is cited by workflow file and run ID, never by job name. It was not dispatched for this lane.

No staging or production database was read or written by this lane.

## Merge SHA Binding

Merge SHA: `1ba31df783f8e7ca36a27729b79be6a9c7461469`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1829
