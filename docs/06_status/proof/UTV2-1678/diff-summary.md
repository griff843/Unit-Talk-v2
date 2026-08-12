# UTV2-1678 — diff summary

MERGE_SHA: 533f7c01dfd8c79849a2d0adc9803a1cd5fe41d0

Verified implementation SHA: `7a6466837d33ee898b30fbfdb9b4aa7d1e251e3b`

## Changed files

```
 scripts/ops/merge-wrapper.ts          |  13 +-
 scripts/ops/ops-merge-wrapper.test.ts | 256 ++++++++++++++++++++++++++++++--
 scripts/ops/ops-merge-wrapper.ts      | 272 ++++++++++++++++++++++++++++++++--
 3 files changed, 517 insertions(+), 24 deletions(-)
```

All paths are inside the lane's declared `file_scope_lock`. No file outside the
lock was touched.

## `scripts/ops/merge-wrapper.ts`

Adds two codes to the `MergeWrapperResult` failure union:

- `merge_wrapper_diverged_requires_explicit_sync` — main-sync refusing to choose a
  verb on the caller's behalf.
- `merge_wrapper_sync_dropped_protected_paths` — a completed sync that dropped a
  governance artifact, reported after the tree has been restored.

No behavioral change in this file; it owns the type only.

## `scripts/ops/ops-merge-wrapper.ts`

**Removed** the implicit rebase fallback in `runExtendedMergeWrapper`. On a
non-fast-forwardable `main-sync` the wrapper now returns the refusal code with a
message naming both explicit verbs and marking which one rewrites history. No git
mutation is performed.

**Added:**

- `isNotFastForwardFailure(result)` — exported predicate isolating a genuine
  divergence failure from any other command failure, so an unrelated git error
  keeps its own code rather than presenting as a routine divergence.
- `PROTECTED_SYNC_PATH_PREFIXES` — `docs/06_status/proof/`, `docs/06_status/lanes/`.
- `classifyDroppedPaths(before, after)` — pure comparison of the branch-only file
  set across the sync, split into refusal-worthy and warn-only.
- `HEAD_MOVE_REAUTHORIZATION_ORDER`, `buildHeadMoveInvalidation(prev, cur)`,
  `renderHeadMoveNotice(inv)` — the invalidation report for a head-SHA move.
- Post-sync wiring: the pre-sync head is captured lazily inside the intercepting
  runner; on success the two branch-only diffs are compared, a protected drop is
  refused and restored via `git reset --keep`, other drops warn, and a head move
  appends the invalidation notice.

## `scripts/ops/ops-merge-wrapper.test.ts`

Adds nine UTV2-1678 tests and updates five existing expectations. One prior test
(`main-sync falls back to rebase on not-possible-to-fast-forward error`) is
replaced because it asserted the defect. Full rationale in `verification.md`.

## Not changed, deliberately

- The merge mutex — acquire/release semantics are untouched and asserted
  unchanged by the existing suite.
- `git-merge-main` / `git-rebase-main` behavior — both remain directly callable
  and do exactly what they did before.
- No heuristic verb auto-selection was introduced; that would reintroduce the
  class of defect this lane removes.
- `MAIN_SYNC_STASH_PATHS` — it covers `.ops/sync` and `docs/06_status/lanes` but
  not `docs/06_status/proof/`. That gap is real and belongs to UTV2-1690
  (execution hygiene); folding it in would widen a T1 lane.
