# Diff summary: WORK-2026103002

Implementation files, from `git diff --stat origin/main...f1c0f0c46 -- .github scripts .ops/work`:

```
 .github/workflows/post-merge-lane-close.yml |  62 +++++++++++++++--
 .ops/work/WORK-2026103002.md                |  43 ++++++++++++
 scripts/ops/workflow-hardening.test.ts      | 100 +++++++++++++++++++++++++++-
 3 files changed, 199 insertions(+), 6 deletions(-)
```

| File | Change |
|---|---|
| `.github/workflows/post-merge-lane-close.yml` | New push-only `wait-for-merge-ci` job polls `ci.yml` runs for the merge SHA and finishes once all have completed. It never blocks indefinitely: it proceeds with a warning after 5 minutes with no run, or after 50 minutes whatever the state. `lane-close` now `needs` it under `!cancelled()`. The `merge-closeout-mutex` concurrency group moves from the workflow to the `lane-close` job. |
| `scripts/ops/workflow-hardening.test.ts` | Executes the wait step's script, as written, against a stubbed `gh`, and asserts the job structure. The UTV2-1713 mutex test reads the job-level group. |
| `.ops/work/WORK-2026103002.md` | The lane's repo-owned work order. |

Lane metadata (`.ops/sync/`, `docs/06_status/lanes/`, `docs/06_status/proof/`) is excluded from the figure above.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1807
