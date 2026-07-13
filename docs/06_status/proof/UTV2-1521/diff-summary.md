# UTV2-1521 Diff Summary

Generated at: 2026-07-11T12:58:52.636Z
Issue: UTV2-1521
Tier: T1
Lane type: governance
Branch: claude/utv2-1521-authenticate-scope-override
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1191
Head SHA: f393e688e37a7cdb581740b350f8f0268fc76574
Merge SHA: 411f6f2c8c418bcb57ceb76d9e09b912843468f3
Diff base: 411f6f2c8c418bcb57ceb76d9e09b912843468f3^1
Diff target: 411f6f2c8c418bcb57ceb76d9e09b912843468f3

## Git Diff Stat
```
.github/workflows/file-scope-lock-check.yml     |  93 ++++++++++-
 .ops/sync/UTV2-1521.yml                         |  10 ++
 docs/05_operations/schemas/scope-override-v1.md |  70 +++++++++
 docs/06_status/KNOWN_DEBT.md                    |   6 +-
 docs/06_status/lanes/UTV2-1521.json             |  42 +++++
 docs/06_status/proof/UTV2-1521/.gitkeep         |   0
 docs/06_status/proof/UTV2-1521/diff-summary.md  |  30 ++++
 docs/06_status/proof/UTV2-1521/evidence.json    | 110 +++++++++++++
 docs/06_status/proof/UTV2-1521/verification.md  |  69 ++++++++
 scripts/ci/file-scope-guard.test.ts             | 179 ++++++++++++++++-----
 scripts/ci/file-scope-guard.ts                  | 200 +++++++++++++++++++-----
 scripts/ops/merge-risk.ts                       |   6 +
 12 files changed, 726 insertions(+), 89 deletions(-)
```

## Git Name Status
```
M	.github/workflows/file-scope-lock-check.yml
A	.ops/sync/UTV2-1521.yml
A	docs/05_operations/schemas/scope-override-v1.md
M	docs/06_status/KNOWN_DEBT.md
A	docs/06_status/lanes/UTV2-1521.json
A	docs/06_status/proof/UTV2-1521/.gitkeep
A	docs/06_status/proof/UTV2-1521/diff-summary.md
A	docs/06_status/proof/UTV2-1521/evidence.json
A	docs/06_status/proof/UTV2-1521/verification.md
M	scripts/ci/file-scope-guard.test.ts
M	scripts/ci/file-scope-guard.ts
M	scripts/ops/merge-risk.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: f393e688e37a7cdb581740b350f8f0268fc76574
Merge SHA: 411f6f2c8c418bcb57ceb76d9e09b912843468f3
