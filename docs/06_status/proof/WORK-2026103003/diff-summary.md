# Diff summary: WORK-2026103003

Implementation files, from `git diff --stat origin/main...957e02580 -- .github scripts .ops/work`:

```
 .github/workflows/post-merge-lane-close.yml |  6 +++++
 .ops/work/WORK-2026103003.md                | 37 +++++++++++++++++++++++++++++
 scripts/ops/workflow-hardening.test.ts      | 12 ++++++++++
 3 files changed, 55 insertions(+)
```

| File | Change |
|---|---|
| `.github/workflows/post-merge-lane-close.yml` | `lane-close`'s checkout gains `ref: ${{ github.ref }}`, so it checks out the tip of `main` after the CI wait instead of the merge SHA. A comment states why, and that merge identity stays pinned by `Resolve merge SHA` and G3. |
| `scripts/ops/workflow-hardening.test.ts` | Asserts `lane-close` has exactly one checkout and that its `ref` is `${{ github.ref }}`. |
| `.ops/work/WORK-2026103003.md` | The lane's repo-owned work order. |

Lane metadata (`.ops/sync/`, `docs/06_status/lanes/`, `docs/06_status/proof/`) is excluded from the figure above.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1809
