# UTV2-1729 Diff Summary

Generated at: 2026-08-22T04:48:53Z
Issue: UTV2-1729
Tier: T1
Lane type: governance
Branch: codex/utv2-1729-proof-producing-contract
PR URL: N/A
Head SHA: 391fad90e4fbaeb3e8a0e4d6af852b34778b8532
Merge SHA: N/A
Diff base: 92889b2d3a858345e99ca490cc11946f7293ca18
Diff target: 391fad90e4fbaeb3e8a0e4d6af852b34778b8532

## Git Diff Stat
```
.github/workflows/post-merge-lane-close.yml       |  15 +-
 .ops/sync/UTV2-1729.yml                           |  13 +
 docs/06_status/lanes/UTV2-1729.json               |  62 ++++
 docs/06_status/proof/UTV2-1729/diff-summary.md    |  58 ++++
 docs/06_status/proof/UTV2-1729/evidence.json      |  49 ++++
 docs/06_status/proof/UTV2-1729/model-routing.json |  14 +
 docs/06_status/proof/UTV2-1729/verification.md    |  61 ++++
 scripts/ci/proof-binding-validator.ts             |  88 +++++-
 scripts/ops/lane-close.test.ts                    | 113 +++++++-
 scripts/ops/lane-close.ts                         |  97 ++++++-
 scripts/ops/model-routing.test.ts                 |  40 +++
 scripts/ops/model-routing.ts                      |  65 +++++
 scripts/ops/proof-generate.test.ts                | 160 +++++++++--
 scripts/ops/proof-generate.ts                     | 332 ++++++++++++++++++++--
 scripts/ops/proof-rebind.test.ts                  |  31 ++
 scripts/ops/proof-rebind.ts                       | 118 +++++++-
 scripts/ops/proof-schema.test.ts                  |  69 ++++-
 scripts/ops/proof-schema.ts                       |  55 +++-
 18 files changed, 1369 insertions(+), 71 deletions(-)
```

## Git Name Status
```
M	.github/workflows/post-merge-lane-close.yml
A	.ops/sync/UTV2-1729.yml
A	docs/06_status/lanes/UTV2-1729.json
A	docs/06_status/proof/UTV2-1729/diff-summary.md
A	docs/06_status/proof/UTV2-1729/evidence.json
A	docs/06_status/proof/UTV2-1729/model-routing.json
A	docs/06_status/proof/UTV2-1729/verification.md
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
Head SHA: 391fad90e4fbaeb3e8a0e4d6af852b34778b8532
Merge SHA: N/A
