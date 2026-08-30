# UTV2-1729 Diff Summary

Generated at: 2026-08-22T05:19:31Z
Issue: UTV2-1729
Tier: T1
Lane type: governance
Branch: codex/utv2-1729-proof-producing-contract
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1436
Head SHA: 0c915811cd40b312bd3bdb4094062c29f6632c71
Merge SHA: N/A
Diff base: efdbd298df76e319bc85926c3c16a90240abbf28
Diff target: 0c915811cd40b312bd3bdb4094062c29f6632c71

## Git Diff Stat
```
.github/workflows/post-merge-lane-close.yml       |  15 +-
 .ops/sync/UTV2-1729.yml                           |  13 +
 docs/06_status/lanes/UTV2-1729.json               |  62 ++++
 docs/06_status/proof/UTV2-1729/diff-summary.md    |  64 +++++
 docs/06_status/proof/UTV2-1729/evidence.json      |  49 ++++
 docs/06_status/proof/UTV2-1729/model-routing.json |  14 +
 docs/06_status/proof/UTV2-1729/verification.md    |  61 ++++
 scripts/ci/proof-binding-validator.ts             |  88 +++++-
 scripts/ops/lane-close.test.ts                    | 217 +++++++++++++-
 scripts/ops/lane-close.ts                         | 187 +++++++++++-
 scripts/ops/model-routing.test.ts                 |  40 +++
 scripts/ops/model-routing.ts                      |  65 +++++
 scripts/ops/proof-generate.test.ts                | 160 +++++++++--
 scripts/ops/proof-generate.ts                     | 332 ++++++++++++++++++++--
 scripts/ops/proof-rebind.test.ts                  |  31 ++
 scripts/ops/proof-rebind.ts                       | 118 +++++++-
 scripts/ops/proof-schema.test.ts                  |  69 ++++-
 scripts/ops/proof-schema.ts                       |  55 +++-
 18 files changed, 1569 insertions(+), 71 deletions(-)
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
Head SHA: 0c915811cd40b312bd3bdb4094062c29f6632c71
Merge SHA: N/A
