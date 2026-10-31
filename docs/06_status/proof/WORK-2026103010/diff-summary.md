# Diff summary: WORK-2026103010

Implementation files, from `git diff --stat origin/main...3adab5372 -- scripts .ops/work`:

```
 .ops/work/WORK-2026103010.md   | 55 ++++++++++++++++++++++++++++++++++++++++++
 scripts/ops/cli-args-guard.ts  | 26 ++++++++++++++++++++
 scripts/ops/lane-start.test.ts | 25 ++++++++++++++++++-
 scripts/ops/lane-start.ts      |  5 ++++
 scripts/ops/preflight.ts       | 11 +++++++++
 5 files changed, 121 insertions(+), 1 deletion(-)
```

| File | Change |
|---|---|
| `scripts/ops/cli-args-guard.ts` | New. `assertSingleIssueArgs` throws on any positional after the issue ID and on a `--files` value containing a comma, naming the repeat-the-flag form. Pure. |
| `scripts/ops/lane-start.ts` | Calls the guard inside `main()`'s try, after the UTV2-1546 delegation kill switch and before the missing-argument check, lease, worktree or manifest. The existing catch reports it as `lane_start_failed`. |
| `scripts/ops/preflight.ts` | Calls the guard after the existing `--tier`/`--branch` check and reports a failure as an `ARGS` check, the existing pattern, before any baseline run. |
| `scripts/ops/lane-start.test.ts` | Four tests of the guard through the real `parseArgs`. |
| `.ops/work/WORK-2026103010.md` | The lane's repo-owned work order. |

`parseArgs` and `scripts/ops/shared.ts` are unchanged. Lane metadata (`.ops/sync/`, `docs/06_status/lanes/`, `docs/06_status/proof/`) is excluded from the figure above.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1814
