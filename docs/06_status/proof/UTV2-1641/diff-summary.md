# UTV2-1641 Diff Summary

Generated at: 2026-08-01T05:36:16.386Z
Issue: UTV2-1641
Tier: T1
Lane type: governance
Branch: claude/utv2-1641-1642-proof-lifecycle-fixes
PR URL: N/A
Head SHA: 02e26bfb30121f3021be733c68e8c00a7b35d5c9
Merge SHA: N/A
Diff base: 1295d0abd7cb5e65f30e80f0e2289c321e71653f
Diff target: 02e26bfb30121f3021be733c68e8c00a7b35d5c9

## Git Diff Stat
```
.ops/sync/UTV2-1641.yml                            |   10 +
 docs/06_status/lanes/UTV2-1641.json                |   50 +
 docs/06_status/proof/UTV2-1641/.gitkeep            |    0
 docs/06_status/proof/UTV2-1641/diff-summary.md     |   56 +
 docs/06_status/proof/UTV2-1641/evidence.json       |  121 ++
 docs/06_status/proof/UTV2-1641/verification.md     |  273 +++++
 package.json                                       |    2 +-
 .../real-utv2-1399-job-log.txt                     | 1235 ++++++++++++++++++++
 .../real-utv2-1399-receipt.json                    |   31 +
 scripts/ops/ci-db-proof-harvest.test.ts            |  445 +++++++
 scripts/ops/ci-db-proof-harvest.ts                 |  710 +++++++++++
 scripts/ops/proof-generate.test.ts                 |  211 ++++
 scripts/ops/proof-generate.ts                      |  149 ++-
 scripts/ops/proof-repair.test.ts                   |   95 ++
 scripts/ops/proof-repair.ts                        |   17 +-
 scripts/ops/shared.test.ts                         |   27 +
 scripts/ops/shared.ts                              |   34 +
 17 files changed, 3463 insertions(+), 3 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1641.yml
A	docs/06_status/lanes/UTV2-1641.json
A	docs/06_status/proof/UTV2-1641/.gitkeep
A	docs/06_status/proof/UTV2-1641/diff-summary.md
A	docs/06_status/proof/UTV2-1641/evidence.json
A	docs/06_status/proof/UTV2-1641/verification.md
M	package.json
A	scripts/ops/__fixtures__/utv2-1641-ci-db-proof/real-utv2-1399-job-log.txt
A	scripts/ops/__fixtures__/utv2-1641-ci-db-proof/real-utv2-1399-receipt.json
A	scripts/ops/ci-db-proof-harvest.test.ts
A	scripts/ops/ci-db-proof-harvest.ts
M	scripts/ops/proof-generate.test.ts
M	scripts/ops/proof-generate.ts
M	scripts/ops/proof-repair.test.ts
M	scripts/ops/proof-repair.ts
M	scripts/ops/shared.test.ts
M	scripts/ops/shared.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 02e26bfb30121f3021be733c68e8c00a7b35d5c9
Merge SHA: N/A
