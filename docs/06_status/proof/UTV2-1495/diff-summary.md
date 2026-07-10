# UTV2-1495 Diff Summary

Generated at: 2026-07-10T14:00:26.928Z
Issue: UTV2-1495
Tier: T2
Lane type: governance
Branch: codex/utv2-1495-hard-file-scope-lock-enforcement
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1182
Head SHA: 84bffbd9b27176cd68833b65f1f5aca3342d8c5f
Merge SHA: 0789473bc9cccf1f9e06e306693f112e2ecf79e3
Diff base: 0789473bc9cccf1f9e06e306693f112e2ecf79e3^1
Diff target: 0789473bc9cccf1f9e06e306693f112e2ecf79e3

## Git Diff Stat
```
.github/workflows/file-scope-lock-check.yml    | 187 +++++-----
 .ops/sync/UTV2-1495.yml                        |  10 +
 docs/06_status/lanes/UTV2-1495.json            |  45 +++
 docs/06_status/proof/UTV2-1495/.gitkeep        |   0
 docs/06_status/proof/UTV2-1495/diff-summary.md |  28 ++
 docs/06_status/proof/UTV2-1495/verification.md |  58 ++++
 package.json                                   |   2 +-
 scripts/ci/file-scope-guard.test.ts            | 410 ++++++++++++++++++++++
 scripts/ci/file-scope-guard.ts                 | 457 +++++++++++++++++++++++++
 9 files changed, 1104 insertions(+), 93 deletions(-)
```

## Git Name Status
```
M	.github/workflows/file-scope-lock-check.yml
A	.ops/sync/UTV2-1495.yml
A	docs/06_status/lanes/UTV2-1495.json
A	docs/06_status/proof/UTV2-1495/.gitkeep
A	docs/06_status/proof/UTV2-1495/diff-summary.md
A	docs/06_status/proof/UTV2-1495/verification.md
M	package.json
A	scripts/ci/file-scope-guard.test.ts
A	scripts/ci/file-scope-guard.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 84bffbd9b27176cd68833b65f1f5aca3342d8c5f
Merge SHA: 0789473bc9cccf1f9e06e306693f112e2ecf79e3
