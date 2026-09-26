# WORK-2026092502 Diff Summary

Generated at: 2026-09-25T20:35:57.000Z
Issue: WORK-2026092502
Tier: T1
Lane type: governance
Branch: claude/work-2026092502-warehouse-historical-backfill
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1650
Head SHA: 629b27507f5219ee75062dcd88089d84f951ea3e
Merge SHA: pending merge
Diff base: d4253e8c59a43c42d9ce31714cbd47030504f660 (origin/main)
Diff target: 629b27507f5219ee75062dcd88089d84f951ea3e

## Git Diff Stat
```
 .github/workflows/warehouse-archive-conveyor.yml | 140 +++++-
 .ops/sync/WORK-2026092502.yml                    | 217 ++++++++
 docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md |  32 ++
 docs/06_status/lanes/WORK-2026092502.json        |  46 ++
 docs/06_status/proof/WORK-2026092502/.gitkeep    |   0
 scripts/warehouse/backfill.ts                    | 395 +++++++++++++++
 scripts/warehouse/cli.ts                         | 124 ++++-
 scripts/warehouse/config.test.ts                 |  93 ++++
 scripts/warehouse/config.ts                      | 119 ++++-
 scripts/warehouse/conveyor-workflow.test.ts      | 186 +++++++
 scripts/warehouse/conveyor.test.ts               | 615 ++++++++++++++++++++++-
 scripts/warehouse/conveyor.ts                    | 197 +++++++-
 scripts/warehouse/object-store.ts                |  25 +
 scripts/warehouse/query.test.ts                  |  35 ++
 scripts/warehouse/query.ts                       |   7 +-
 15 files changed, 2197 insertions(+), 34 deletions(-)
```

## What changed

- `scripts/warehouse/conveyor.ts`: `'window-year'` season; key construction inside the per-item
  `try`; `raw` target override; `pruneHold`; `decideRetentionEligibility`; optional `heartbeatKey`.
- `scripts/warehouse/backfill.ts` (new): `planBackfill`, `runBackfill`, the progress ledger.
- `scripts/warehouse/config.ts`, `object-store.ts`, `query.ts`: reader-only research path and its
  refusal; `describeConfig` reports research readiness by presence only.
- `scripts/warehouse/cli.ts`: `backfill` subcommand, reader-only `query`, `doctor --research`.
- `.github/workflows/warehouse-archive-conveyor.yml`: main-only `workflow_dispatch` backfill mode.
- `docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md`: §7 reader-only read path; §8 bullets; §8a.
- Tests: `conveyor.test.ts`, `conveyor-workflow.test.ts`, `config.test.ts`, `query.test.ts`.
