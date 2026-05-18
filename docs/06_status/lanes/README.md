# Lane Manifest Directory

This directory contains repo-local lane manifests.

## Current Semantics

Only these canonical statuses count as active execution state:

- `started`
- `in_progress`
- `in_review`
- `blocked`
- `reopened`

Closed statuses such as `done` and `merged` are historical records in place. Legacy statuses such as `in-review`, `closed`, `cancelled`, and `abandoned` may still exist in old manifests and should be treated as historical data, not current execution demand. They remain here because current tooling, CI checks, proof references, and reconciliation agents read `docs/06_status/lanes/*.json` directly.

## Truth Order

1. Linear is live issue state.
2. GitHub is PR/check state.
3. These manifests are repo-local execution state.
4. `PROGRAM_STATUS.md` and `SYSTEM_STATE.md` are status views.
5. `ISSUE_QUEUE.md` is historical only.

## Archive Policy

Do not bulk-move old manifests until tooling supports an archive path. A future cleanup may move closed manifests to `docs/06_status/lanes/archive/` after all readers explicitly ignore or include that path as intended.
