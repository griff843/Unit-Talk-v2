# UTV2-1729 Diff Summary

Generated at: 2026-08-22T01:07:49.862Z
Issue: UTV2-1729
Tier: T1
Lane type: governance
Branch: codex/utv2-1729-proof-producing-contract
PR URL: N/A
Head SHA: 7d7347df7f252e7318a0dc19c1e1cb1a545a3d05
Merge SHA: N/A
Diff base: 92889b2d3a858345e99ca490cc11946f7293ca18
Diff target: 7d7347df7f252e7318a0dc19c1e1cb1a545a3d05

## Git Diff Stat
```
.github/workflows/post-merge-lane-close.yml |  15 +-
 .ops/sync/UTV2-1729.yml                     |  10 +
 docs/06_status/lanes/UTV2-1729.json         |  59 +++++
 docs/06_status/proof/UTV2-1729/.gitkeep     |   0
 scripts/ci/proof-binding-validator.ts       |  88 +++++++-
 scripts/ops/lane-close.test.ts              | 108 ++++++++-
 scripts/ops/lane-close.ts                   |  91 +++++++-
 scripts/ops/model-routing.test.ts           |  40 ++++
 scripts/ops/model-routing.ts                |  65 ++++++
 scripts/ops/proof-generate.test.ts          | 160 ++++++++++++--
 scripts/ops/proof-generate.ts               | 326 +++++++++++++++++++++++++---
 scripts/ops/proof-rebind.test.ts            |  31 +++
 scripts/ops/proof-rebind.ts                 | 118 +++++++++-
 scripts/ops/proof-schema.test.ts            |  69 +++++-
 scripts/ops/proof-schema.ts                 |  55 ++++-
 15 files changed, 1167 insertions(+), 68 deletions(-)
```

## Git Name Status
```
M	.github/workflows/post-merge-lane-close.yml
A	.ops/sync/UTV2-1729.yml
A	docs/06_status/lanes/UTV2-1729.json
A	docs/06_status/proof/UTV2-1729/.gitkeep
M	scripts/ci/proof-binding-validator.ts
M	scripts/ops/lane-close.test.ts
M	scripts/ops/lane-close.ts
M	scripts/ops/model-routing.test.ts
M	scripts/ops/model-routing.ts
M	scripts/ops/proof-generate.test.ts
M	scripts/ops/proof-generate.ts
M	scripts/ops/proof-rebind.test.ts
M	scripts/ops/proof-rebind.ts
M	scripts/ops/proof-schema.test.ts
M	scripts/ops/proof-schema.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 7d7347df7f252e7318a0dc19c1e1cb1a545a3d05
Merge SHA: N/A
