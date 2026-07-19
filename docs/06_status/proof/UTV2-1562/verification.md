# PROOF: UTV2-1562

MERGE_SHA: 92ceefea830fc54c1e7a87ac12bcc9744005dbe6

(This PR has not merged yet -- this is the current pre-merge implementation
SHA, an ancestor of whatever the eventual merge commit will be, not a
placeholder.)

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
$ pnpm exec tsc -b tsconfig.json
(clean, no errors)

$ pnpm exec eslint scripts/ops/lane-close.ts scripts/ops/lane-close.test.ts
(clean, no errors or warnings)

$ pnpm verify:parallel
(exit 0 -- lint + type-check in parallel, then build + test)
```

## Tier

T2 -- no `pnpm test:db` / runtime evidence bundle required per this repo's
tier policy (that requirement is gated on the `tier:T1` label, which this
issue does not carry).
