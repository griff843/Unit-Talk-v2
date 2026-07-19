# UTV2-1553 Diff Summary

Issue: UTV2-1553 (this PR addresses one specific mechanical defect within
the issue's broader post-merge-closeout scope, not the full issue)
Tier: T2
Lane type: hygiene
Branch: `claude/utv2-1553-lane-close-history-persist-fix`

## Changes

- `scripts/ops/lane-close.ts` — extracted the terminal `status: 'done'`
  mutation from `main()`'s inline logic into an exported
  `finalizeLaneCloseManifest(issueId)` function that re-reads the manifest
  from disk before mutating, instead of writing back a stale in-memory
  snapshot taken before `runTruthCheck()` ran. Fixes a real bug where a
  successful `ops:lane-close` could persist a terminal `status: done` while
  the `truth_check_history` array's last entry remained a stale prior
  failure (discovered live while reconciling UTV2-1543 / PR #1257 and
  #1260).
- `scripts/ops/lane-close.test.ts` — new regression test reproducing the
  exact bug pattern (a `runTruthCheck()`-style concurrent disk write
  followed by a stale-snapshot-based finalize call) against the extracted
  function.

## Relationship to UTV2-1553's full scope

UTV2-1553 is the parent issue for post-merge-closeout capacity/lease
correctness. This PR fixes one concrete, narrowly-scoped mechanical defect
within that space (stale-manifest history clobbering on the normal close
path) discovered as a direct blocker to correctly closing UTV2-1543. The
remaining UTV2-1553 scope (reserved control-plane capacity independent of
the governance implementation cap, idempotent lease release across the
`--repair-merged` and normal paths more broadly, sweeping existing ghost
leases) is unaddressed by this PR and remains open.

## Explicitly not changed

- No change to `--repair-merged` path logic.
- No change to merge-lock acquisition/release semantics.
- No change to lease release semantics.
- No change to truth-check gate logic itself (`truth-check-lib.ts` untouched).
