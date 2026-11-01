# Diff summary: WORK-2026110101

Implementation files, from `git diff --stat origin/main...86bc6c88b -- scripts .ops/work`:

```
 .ops/work/WORK-2026110101.md                | 42 +++++++++++++++++++++++++++++
 scripts/ci/staging-fixture-reap.ts          | 25 +++++++++++++++--
 scripts/ci/staging-path-enforcement.test.ts | 42 +++++++++++++++++++++++++++++
 3 files changed, 107 insertions(+), 2 deletions(-)
```

| File | Change |
|---|---|
| `scripts/ci/staging-fixture-reap.ts` | New `KEPT_PICK_STATUS = 'settled'` and skip reason `status_settled`. `selectReapablePicks` checks it last, so its count is exactly what Option B removed. `supabaseReapStore.deletePicks` adds `.neq('status', 'settled')` to every DELETE. The header lists the new guarantee. |
| `scripts/ci/staging-path-enforcement.test.ts` | Two tests: the selection skip, and the exact live DELETE filter chain through a recording client. |
| `.ops/work/WORK-2026110101.md` | The lane's repo-owned work order. |

The workflow file is unchanged. Lane metadata (`.ops/sync/`, `docs/06_status/lanes/`, `docs/06_status/proof/`) is excluded from the figure above.

## SHA Binding

Merge SHA: pending merge
PR: pending
