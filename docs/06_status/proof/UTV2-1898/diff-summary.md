# UTV2-1898 Diff Summary

Generated at: 2026-09-14T00:57:59.341Z
Issue: UTV2-1898
Tier: T1
Lane type: runtime
Branch: claude/utv2-1898-edge-provenance-scope
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1576
Head SHA: d32092e5860515d87d4a14254307034e0ff6beb2
Merge SHA: N/A
Diff base: 8521670603a43377aa93e4a5bf7b2ffb73abf71f
Diff target: d32092e5860515d87d4a14254307034e0ff6beb2

## Git Diff Stat
```
.ops/sync/UTV2-1898.yml                            | 202 +++++++++++
 apps/api/src/golden-regression.test.ts             |  35 +-
 apps/api/src/market-universe-materializer.test.ts  |   2 +-
 apps/api/src/promotion-edge-integration.test.ts    |  93 ++++-
 apps/api/src/promotion-service.ts                  |   6 +-
 apps/api/src/real-edge-scope-regression.test.ts    | 382 +++++++++++++++++++++
 apps/api/src/real-edge-service.ts                  | 289 ++++++++++++++--
 apps/api/src/submission-service.test.ts            |  72 +++-
 apps/api/src/submission-service.ts                 | 219 ++++++++++--
 apps/api/src/t1-proof-utv2-1898-edge-scope.test.ts | 299 ++++++++++++++++
 apps/ingestor/src/write-surface.ts                 |   2 +-
 docs/05_operations/db-writer-classification.json   |   5 +
 docs/06_status/lanes/UTV2-1898.json                |  48 +++
 package.json                                       |   4 +-
 packages/contracts/src/promotion.ts                |  14 +-
 packages/db/src/repositories.ts                    |  44 ++-
 packages/db/src/runtime-repositories.ts            |  43 +--
 17 files changed, 1650 insertions(+), 109 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1898.yml
M	apps/api/src/golden-regression.test.ts
M	apps/api/src/market-universe-materializer.test.ts
M	apps/api/src/promotion-edge-integration.test.ts
M	apps/api/src/promotion-service.ts
A	apps/api/src/real-edge-scope-regression.test.ts
M	apps/api/src/real-edge-service.ts
M	apps/api/src/submission-service.test.ts
M	apps/api/src/submission-service.ts
A	apps/api/src/t1-proof-utv2-1898-edge-scope.test.ts
M	apps/ingestor/src/write-surface.ts
M	docs/05_operations/db-writer-classification.json
A	docs/06_status/lanes/UTV2-1898.json
M	package.json
M	packages/contracts/src/promotion.ts
M	packages/db/src/repositories.ts
M	packages/db/src/runtime-repositories.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: d32092e5860515d87d4a14254307034e0ff6beb2
Merge SHA: N/A
