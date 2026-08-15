# UTV2-1690 Diff Summary

MERGE_SHA: 6d9f06a4d243b1257e89144b7c73537ab87c5585

Verified implementation SHA: `6d9f06a4d243b1257e89144b7c73537ab87c5585`

- Dispatch leases and the merge mutex now resolve from Git's common directory to the control checkout, so a linked worktree closes the same coordination records that `ops:lane-start` reserved.
- Successful closeout releases the lease before persisting the terminal manifest and retains an exact byte snapshot until that write succeeds. A synchronous persistence failure restores the active lease; successful persistence commits the release.
- Lease release replay is idempotent: released and reclaimed records are not rewritten and do not accumulate synthetic history.
- `ops:lane-finalize` replays terminal-artifact cleanup for an already-done lane before reconciliation, including when its closeout journal previously marked the step complete.
- Truth-check adds M8, which refuses a `done` manifest that still holds an active or stale-reclaim-required control-checkout lease and names `ops:lane-finalize` as the repair path.
- `--repair-merged` now returns named `pr_base_mismatch` for an invalidated binding or an inferred PR whose base is wrong/unresolved, before reachability checks or mutation.
- T1 R1/R2 applicability is derived from GitHub's paginated PR changed-file list. Only a fully classified control-plane diff records `not_applicable`; mixed, missing, and ambiguous scope stays fail-closed, with the reason and classified list in check results.
- Lane PR binding now treats an issue-bearing branch owned by a different registered lane as a clean no-op, while retaining the trusted branch/base validation for genuine lane branches.
- Regression coverage exercises control-root resolution, release commit/rollback, close ordering, finalize replay, M8, wrong-base repair refusal, repository-derived applicability, and workflow identity handling.

No application runtime, database schema, migration, domain contract, delivery path, or production data behavior changed.
