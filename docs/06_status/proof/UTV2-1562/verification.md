# PROOF: UTV2-1562

MERGE_SHA: e07a64b0ff009f02ad16d9ac77ae91504d7ca089

(This is the actual GitHub merge commit for PR #1263, squash-merged to main.)

## Summary

Child issue of UTV2-1553 (T1), split out at PM's direction because a narrow
fragment of a T1 issue cannot inherit T2 authority by staying filed under the
parent -- see PM verdict on PR #1261. Binds `finalizeLaneCloseManifest()` to
the exact passing truth-check result that authorized the close, refusing to
mark a lane `done` if the manifest's history advanced, changed, or failed in
between.

## ASSERTIONS:

- [x] `finalizeLaneCloseManifest()` re-reads the manifest from disk so a fresh
      `truth_check_history` entry written by `runTruthCheck()`'s own side
      effect is not clobbered by a stale in-memory snapshot
- [x] `finalizeLaneCloseManifest()` refuses to close (throws
      `TruthCheckDriftError`) when the manifest's latest history entry no
      longer matches the passing result that authorized the close
- [x] Regression test covers the concurrent-write-preserved case
- [x] Regression test covers the drift-refusal case
- [x] `pnpm verify:parallel` PASS (see EVIDENCE below)
- [x] Type-check and lint clean (see EVIDENCE below)

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/lane-close.test.ts
# tests 66
# suites 0
# pass 66
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

```text
$ pnpm type-check
(pnpm exec tsc -b tsconfig.json -- clean, no errors)

$ pnpm exec eslint scripts/ops/lane-close.ts scripts/ops/lane-close.test.ts
(clean, no errors or warnings)

$ pnpm test
(pnpm exec tsx --test scripts/ops/lane-close.test.ts -- 66/66 pass, see above)

$ pnpm verify:parallel
(exit 0 -- lint + type-check in parallel, then build + test)

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS -- no R-level artifacts required for this diff
```

## Post-merge closeout

Merged to `main` as `e07a64b0` (PR #1263, squash-merge). This proof update is
post-merge bookkeeping only (lane manifest `pr_url`/`commit_sha`/`status`
reconciliation + MERGE_SHA rebind) -- no implementation change. The
post-merge auto-close workflow (`post-merge-lane-close.yml`) could not
complete this itself because the lane manifest merged to `main` via the
squash commit never had `pr_url` populated pre-merge (a process gap: the
lane was started before the PR existed, and the manifest was never updated
with the PR URL afterward) -- `ops:lane-close --repair-merged` refuses with
"no pr_url to repair from" until that's fixed, which is what this PR does.

## Tier

T2 -- no `pnpm test:db` / runtime evidence bundle required per this repo's
tier policy (that requirement is gated on the `tier:T1` label, which this
issue does not carry).
