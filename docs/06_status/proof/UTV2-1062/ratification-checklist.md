# UTV2-1062 Ratification Checklist

This checklist must be completed before Orchestration Kernel v1 is treated as ratified for normal multi-lane operation.

## One-Lane Trial Gate

- [ ] `pnpm ops:lane-start UTV2-1062 ...` creates `docs/06_status/lanes/UTV2-1062.json`, `.ops/sync/UTV2-1062.yml`, and `.ops/leases/UTV2-1062.json`.
- [ ] `.ops/leases/UTV2-1062.json` is `status: active` between lane start and merge.
- [ ] `pnpm ops:merge-wrapper pr-merge --issue UTV2-1062 --branch <branch> --pr <pr> --method squash` acquires and releases the merge mutex.
- [ ] A concurrent `pnpm ops:merge-wrapper pr-merge` attempt while the mutex is held returns `merge_wrapper_lock_held`.
- [ ] `pnpm ops:merge-lock status` or the merge lock JSON shows `status: released` after merge wrapper completion.
- [ ] `pnpm ops:merge-lock acquire --issue UTV2-1062 --branch <branch> --reason ops:lane-close` succeeds before closeout.
- [ ] `pnpm ops:lane-close UTV2-1062` transitions the manifest to `done`.
- [ ] `.ops/leases/UTV2-1062.json` is `status: released` after closeout.
- [ ] `.ops/merge-lock.json` is `status: released` after closeout.
- [ ] `pnpm ops:orchestration-reconcile` returns `PASS` after closeout, or any non-PASS verdict is documented as infra/advisory with concrete evidence.

## Lane Ceiling After Trial

- Before this checklist passes: one real T3 ratification lane only.
- After one clean checklist pass: 3-lane controlled trial.
- After 10 clean wrapper-mediated merges with no lease, cwd, closeout, or reconciler drift: 5-lane standard.
