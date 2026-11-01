# Diff summary: WORK-2026103009

Implementation files, from `git diff --stat origin/main...a0d37b760 -- .github scripts .ops/work`:

```
 .github/workflows/staging-fixture-reap.yml  | 160 +++++++++
 .ops/work/WORK-2026103009.md                |  61 ++++
 scripts/ci/staging-fixture-reap.ts          | 482 ++++++++++++++++++++++++++++
 scripts/ci/staging-path-enforcement.test.ts | 285 ++++++++++++++++
 4 files changed, 988 insertions(+)
```

| File | Change |
|---|---|
| `scripts/ci/staging-fixture-reap.ts` | New. A dry-run-first reaper for aged, unsettled, unreviewed staging picks and the submissions left with no pick. It refuses any non-staging target before a client is constructed. Execute requires a cutoff at least 7 days old and a `--max-picks` cap. Deletes are batched and re-assert `created_at < cutoff`. Every read goes through `readAllVerified`, keyset-paged and checked against an exact count before and after, failing closed on any shortfall or change; each orphaned-submission batch is re-read before its DELETE. Database access sits behind a `ReapStore` interface. |
| `scripts/ci/staging-path-enforcement.test.ts` | Adds the reaper to the real-path entrypoint guard list, 8 tests of its pure selection and argument rules, and 5 tests that run the whole reap against an in-memory store enforcing the 1,000-row response cap and `ON DELETE SET NULL`. |
| `.github/workflows/staging-fixture-reap.yml` | New. `workflow_dispatch` only, bound to `staging-ci`, dry-run by default, in its own non-cancelling concurrency group (never `staging-ci-db`). Writes the report to an artifact and the step summary. |
| `.ops/work/WORK-2026103009.md` | The lane's repo-owned work order. |

Lane metadata (`.ops/sync/`, `docs/06_status/lanes/`, `docs/06_status/proof/`) is excluded from the figure above.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1813
