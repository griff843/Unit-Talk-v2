# WORK-2026092101 Diff Summary

Generated at: 2026-09-21T15:19:18.476Z
Issue: WORK-2026092101
Tier: T1
Lane type: governance
Branch: claude/work-2026092101-historical-data-warehouse
PR URL: N/A
Head SHA: 12fb46bc82fbfc9fa8f11a0ad6a00d2ccb93f44b
Merge SHA: N/A
Diff base: 28c0c79aff4d5a18e84328a3171ff5ffbb3d8c9b
Diff target: 12fb46bc82fbfc9fa8f11a0ad6a00d2ccb93f44b

## Git Diff Stat
```
.github/workflows/warehouse-archive-conveyor.yml   | 111 +++++
 .ops/sync/WORK-2026092101.yml                      | 224 +++++++++
 .../HISTORICAL_MARKET_DATA_WAREHOUSE.md            |  35 +-
 .../FIRST_ARCHIVE_CANDIDATE_PACKET.md              |  86 ++++
 docs/05_operations/PRODUCTION_DB_SIZING_AUDIT.md   | 112 +++++
 docs/05_operations/SGO_REACTIVATION_GATE.md        |  97 ++++
 docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md   | 177 +++++++
 .../WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md       |  85 ++++
 docs/06_status/lanes/WORK-2026092101.json          |  66 +++
 docs/06_status/proof/WORK-2026092101/.gitkeep      |   0
 package.json                                       |   7 +-
 pnpm-lock.yaml                                     | 399 +++++++++++++++-
 scripts/warehouse/README.md                        |  71 +++
 scripts/warehouse/cli.ts                           | 275 +++++++++++
 scripts/warehouse/config.test.ts                   | 126 +++++
 scripts/warehouse/config.ts                        | 178 +++++++
 scripts/warehouse/conveyor-workflow.test.ts        | 111 +++++
 scripts/warehouse/conveyor.test.ts                 | 350 ++++++++++++++
 scripts/warehouse/conveyor.ts                      | 510 +++++++++++++++++++++
 scripts/warehouse/db-audit.test.ts                 | 250 ++++++++++
 scripts/warehouse/db-audit.ts                      | 341 ++++++++++++++
 scripts/warehouse/duckdb.ts                        | 212 +++++++++
 scripts/warehouse/export-partition.test.ts         | 269 +++++++++++
 scripts/warehouse/export-partition.ts              | 288 ++++++++++++
 scripts/warehouse/manifest.test.ts                 | 198 ++++++++
 scripts/warehouse/manifest.ts                      | 337 ++++++++++++++
 scripts/warehouse/object-layout.test.ts            | 179 ++++++++
 scripts/warehouse/object-layout.ts                 | 285 ++++++++++++
 scripts/warehouse/object-store.test.ts             | 151 ++++++
 scripts/warehouse/object-store.ts                  | 291 ++++++++++++
 scripts/warehouse/query.test.ts                    | 156 +++++++
 scripts/warehouse/query.ts                         | 127 +++++
 scripts/warehouse/verify-archive.test.ts           | 400 ++++++++++++++++
 scripts/warehouse/verify-archive.ts                | 282 ++++++++++++
 34 files changed, 6780 insertions(+), 6 deletions(-)
```

## Git Name Status
```
A	.github/workflows/warehouse-archive-conveyor.yml
A	.ops/sync/WORK-2026092101.yml
M	docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md
A	docs/05_operations/FIRST_ARCHIVE_CANDIDATE_PACKET.md
A	docs/05_operations/PRODUCTION_DB_SIZING_AUDIT.md
A	docs/05_operations/SGO_REACTIVATION_GATE.md
A	docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md
A	docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md
A	docs/06_status/lanes/WORK-2026092101.json
A	docs/06_status/proof/WORK-2026092101/.gitkeep
M	package.json
M	pnpm-lock.yaml
A	scripts/warehouse/README.md
A	scripts/warehouse/cli.ts
A	scripts/warehouse/config.test.ts
A	scripts/warehouse/config.ts
A	scripts/warehouse/conveyor-workflow.test.ts
A	scripts/warehouse/conveyor.test.ts
A	scripts/warehouse/conveyor.ts
A	scripts/warehouse/db-audit.test.ts
A	scripts/warehouse/db-audit.ts
A	scripts/warehouse/duckdb.ts
A	scripts/warehouse/export-partition.test.ts
A	scripts/warehouse/export-partition.ts
A	scripts/warehouse/manifest.test.ts
A	scripts/warehouse/manifest.ts
A	scripts/warehouse/object-layout.test.ts
A	scripts/warehouse/object-layout.ts
A	scripts/warehouse/object-store.test.ts
A	scripts/warehouse/object-store.ts
A	scripts/warehouse/query.test.ts
A	scripts/warehouse/query.ts
A	scripts/warehouse/verify-archive.test.ts
A	scripts/warehouse/verify-archive.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 12fb46bc82fbfc9fa8f11a0ad6a00d2ccb93f44b
Merge SHA: N/A
