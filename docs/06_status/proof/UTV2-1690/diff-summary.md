# UTV2-1690 Diff Summary

MERGE_SHA: 261a88dacb6cf123d654fd974576ab1d4cd54a2e

Verified implementation SHA: `261a88dacb6cf123d654fd974576ab1d4cd54a2e`

- Dispatch leases and the merge mutex now resolve from Git's common directory to the control checkout, so a linked worktree closes the same coordination records that `ops:lane-start` reserved.
- Successful closeout releases the lease before persisting the terminal manifest and retains an exact byte snapshot until that write succeeds. A synchronous persistence failure restores the active lease; successful persistence commits the release.
- Lease release replay is idempotent: released and reclaimed records are not rewritten and do not accumulate synthetic history.
- `ops:lane-finalize` replays terminal-artifact cleanup for an already-done lane before reconciliation, including when its closeout journal previously marked the step complete.
- Truth-check adds M8, which refuses a `done` manifest that still holds an active or stale-reclaim-required control-checkout lease and names `ops:lane-finalize` as the repair path.
- Regression coverage exercises control-root resolution, release commit/rollback, close ordering, finalize replay, and the M8 terminal invariant against real temporary filesystem records.

No application runtime, database schema, migration, domain contract, delivery path, or production data behavior changed.
