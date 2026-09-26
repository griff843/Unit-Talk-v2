# WORK-2026092607 Diff Summary

Generated at: 2026-09-26T17:04:14.000Z
Issue: WORK-2026092607
Tier: T2
Lane type: governance
Branch: claude/work-2026092607-warehouse-telemetry-coverage
PR URL: PR_URL_TBD
Head SHA: 386c008dbcd0e8171526bd31fa5f6bbad74478b5
Merge SHA: pending merge
Diff base: 5710c8fe4a8838910a2277316f216a6497db5fd4 (origin/main)
Diff target: 386c008dbcd0e8171526bd31fa5f6bbad74478b5

## Git Diff Stat
```
 .github/workflows/warehouse-archive-conveyor.yml   |   3 +
 .ops/sync/WORK-2026092607.yml                      | 115 ++++++++++++++++++
 docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md   |  15 +++
 .../WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md          |  40 +++++-
 .../WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md       |  11 +-
 docs/06_status/lanes/WORK-2026092607.json          |  46 +++++++
 docs/06_status/proof/WORK-2026092607/.gitkeep      |   0
 scripts/warehouse/README.md                        |   5 +
 scripts/warehouse/backfill.ts                      |   3 +
 scripts/warehouse/conveyor-workflow.test.ts        |  30 ++++-
 scripts/warehouse/conveyor.test.ts                 | 135 +++++++++++++++++----
 scripts/warehouse/conveyor.ts                      |  56 ++++++++-
 12 files changed, 422 insertions(+), 37 deletions(-)
```

## What changed

- `scripts/warehouse/conveyor.ts`: `DEFAULT_RETENTION_POLICY` gains `public.raw_payloads` (21 days hot),
  `public.odds_snapshots` (45) and `public.system_runs` (90, windowed on `started_at`), each filed
  under `raw/{table}/`. `domain` is optional for raw targets; a canonical entry without one is
  refused by `requireDomain` instead of being filed under a guessed domain.
- `scripts/warehouse/backfill.ts`: the three tables are backfill sources using the conveyor's own entry.
- `.github/workflows/warehouse-archive-conveyor.yml`: the dispatch `source` choices include them.
- Tests: the workflow's offered sources must equal `BACKFILL_SOURCES`; every policy entry is
  backfillable with the same entry; no two sources share a data or manifest key over four years;
  only the quarantine is held; the production policy's four keys round-trip; an end-to-end run
  archives telemetry with a JSON column and open runs.
- Docs: contract §8 archive table; backfill plan §3c (measured ranges, credential content scan),
  object names, dispatch steps 4–6; provisioning doc reader grants (reserved DDL, not applied); README.
