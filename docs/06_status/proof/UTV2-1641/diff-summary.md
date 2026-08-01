# UTV2-1641 Diff Summary

Generated at: 2026-08-01T05:45:21.200Z
Issue: UTV2-1641
Tier: T1
Lane type: governance
Branch: claude/utv2-1641-1642-proof-lifecycle-fixes
PR URL: N/A
Head SHA: 9869652c246007e8de916f593ee66986bbfd117b
Merge SHA: N/A
Diff base: 6afd7fb6f809d2b8e9db84fa7ecd55e10656d626
Diff target: 9869652c246007e8de916f593ee66986bbfd117b

## Git Diff Stat
```
.ops/sync/{UTV2-1641.yml => UTV2-1644.yml}         |    2 +-
 docs/06_status/lanes/UTV2-1641.json                |   19 +-
 docs/06_status/lanes/UTV2-1644.json                |   41 +
 docs/06_status/proof/UTV2-1641/.gitkeep            |    0
 docs/06_status/proof/UTV2-1641/diff-summary.md     |   60 +
 docs/06_status/proof/UTV2-1641/evidence.json       |  134 +++
 docs/06_status/proof/UTV2-1641/verification.md     |  273 +++++
 docs/06_status/proof/UTV2-1644/.gitkeep            |    0
 docs/06_status/proof/UTV2-1644/verification.md     |   60 +
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
 20 files changed, 3539 insertions(+), 6 deletions(-)
```

## Git Name Status
```
R089	.ops/sync/UTV2-1641.yml	.ops/sync/UTV2-1644.yml
M	docs/06_status/lanes/UTV2-1641.json
A	docs/06_status/lanes/UTV2-1644.json
A	docs/06_status/proof/UTV2-1641/.gitkeep
A	docs/06_status/proof/UTV2-1641/diff-summary.md
A	docs/06_status/proof/UTV2-1641/evidence.json
A	docs/06_status/proof/UTV2-1641/verification.md
A	docs/06_status/proof/UTV2-1644/.gitkeep
A	docs/06_status/proof/UTV2-1644/verification.md
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
Head SHA: 9869652c246007e8de916f593ee66986bbfd117b
Merge SHA: N/A
