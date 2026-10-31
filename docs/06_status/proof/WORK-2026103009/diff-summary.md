# Diff summary: WORK-2026103009

Implementation files, from `git diff --stat origin/main...72b91c897 -- .github scripts .ops/work`:

```
 .github/workflows/staging-fixture-reap.yml  | 160 ++++++++++++
 .ops/work/WORK-2026103009.md                |  58 +++++
 scripts/ci/staging-fixture-reap.ts          | 376 ++++++++++++++++++++++++++++
 scripts/ci/staging-path-enforcement.test.ts |  96 +++++++
 4 files changed, 690 insertions(+)
```

| File | Change |
|---|---|
| `scripts/ci/staging-fixture-reap.ts` | New. A dry-run-first reaper for aged, unsettled, unreviewed staging picks and the submissions left with no pick. It refuses any non-staging target before a client is constructed. Execute requires a cutoff at least 7 days old and a `--max-picks` cap. Deletes are batched and re-assert `created_at < cutoff`. |
| `scripts/ci/staging-path-enforcement.test.ts` | Adds the reaper to the real-path entrypoint guard list and 8 tests of its pure selection and argument rules. |
| `.github/workflows/staging-fixture-reap.yml` | New. `workflow_dispatch` only, bound to `staging-ci`, dry-run by default, in its own non-cancelling concurrency group (never `staging-ci-db`). Writes the report to an artifact and the step summary. |
| `.ops/work/WORK-2026103009.md` | The lane's repo-owned work order. |

Lane metadata (`.ops/sync/`, `docs/06_status/lanes/`, `docs/06_status/proof/`) is excluded from the figure above.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1813
