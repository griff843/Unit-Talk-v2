# PROOF: WORK-2026092501

MERGE_SHA: 17bade59b215906d66b116fa93e832fb2f487be6

Generated at: 2026-09-25T17:58:17.000Z
Issue: WORK-2026092501
Tier: T2
Lane type: governance
Branch: claude/work-2026092501-tier-c-hook-abs-paths
Head SHA: 17bade59b215906d66b116fa93e832fb2f487be6
result: pass

## ASSERTIONS:

- [x] An absolute Tier C path now gets the Tier C warning (exit 2). On `main` it exited 0,
      because only a legacy `Unit-Talk-v2-main/` prefix was stripped.
- [x] A relative Tier C path still exits 2. A non-Tier-C path and a path outside any git
      repository exit 0.
- [x] The manifest-authorized bypass reads the branch and the `UTV2-*`, `UNI-*` and `WORK-*`
      manifests of the worktree that contains the target, not the hook's cwd. An open WORK
      manifest on that branch that locks the file exits 0. The same manifest `done`, or on another
      branch, exits 2.
- [x] Which paths are Tier C, the warning text, and every workflow are unchanged.
- [x] Mutation drill: with `main`'s hook in place, 2 of the 3 new tests fail.

## EVIDENCE:

Measured on `17bade59b215906d66b116fa93e832fb2f487be6` in the lane worktree.

### 1. Mutation drill

`main`'s `.claude/hooks/tier-c-path-guard.sh` was restored alone, the new tests were run, and then the change was restored.

```
$ pnpm exec tsx --test --test-name-pattern='tier-c-path-guard' scripts/ops/workflow-hardening.test.ts   # main's hook
not ok 1 - tier-c-path-guard classifies an absolute Tier C path, not only a relative one
not ok 3 - tier-c-path-guard honours a WORK lane manifest from the target worktree, and only an open one on its branch
# pass 1
# fail 2

$ pnpm exec tsx --test --test-name-pattern='tier-c-path-guard' scripts/ops/workflow-hardening.test.ts   # this lane
# pass 3
# fail 0
```

### 2. Tests

```
$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
# pass 73
# fail 0

$ pnpm test
tests 6873, pass 6873, fail 0 (zero 'not ok' TAP lines across the workspace)
exit 0
```

### R-level

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm exec eslint scripts/ops/workflow-hardening.test.ts`: exit 0
- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts`: 73 pass, 0 fail
- [x] `pnpm test`: 6873 pass, 0 fail
- [x] `ops:preflight`: PASS, 38 checks
- [x] Mutation drill: `main`'s hook turns 2 named tests red
- [ ] `pnpm verify`: cannot exit 0 from a containment-isolated checkout.
      `ci:assert-staging` refuses because `local.env` pins `SUPABASE_URL` to loopback.
      CI runs `verify` on the PR.

## Runtime Verification

This lane is T2 and changes only a local Claude Code PreToolUse hook, which no service executes.
There is no runtime or database surface, and no live-DB proof is claimed.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1649
Execution SHA: 17bade59b215906d66b116fa93e832fb2f487be6
