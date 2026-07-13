# UTV2-1524 Diff Summary

Generated at: 2026-07-13T06:40:06.544Z
Issue: UTV2-1524
Tier: T1
Lane type: governance
Branch: claude/utv2-1524-scope-override-parser-fix
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1194
Head SHA: 79677ab6b491a0e6bc10594df692d6ccf0e92ce0
Merge SHA: N/A
Diff base: 801929c61eec600177c6f57845d0db9aad742e59
Diff target: 79677ab6b491a0e6bc10594df692d6ccf0e92ce0

## Git Diff Stat
```
.github/workflows/file-scope-lock-check.yml      |  28 ++--
 .lane/lanes/governance.yml                       |   7 +
 .ops/sync/UTV2-1524.yml                          |  10 ++
 docs/06_status/KNOWN_DEBT.md                     |   5 +-
 docs/06_status/UTV2-1524-EVIDENCE-BUNDLE.md      | 163 +++++++++++++++++++++++
 docs/06_status/evidence/UTV2-1524/.gitkeep       |   0
 docs/06_status/lanes/UTV2-1524.json              |  48 +++++++
 docs/06_status/proof/UTV2-1524/.gitkeep          |   0
 docs/06_status/proof/UTV2-1524/diff-summary.md   |  54 ++++++++
 docs/06_status/proof/UTV2-1524/evidence.json     |  54 ++++++++
 docs/06_status/proof/UTV2-1524/verification.md   |  41 ++++++
 package.json                                     |   2 +-
 scripts/ci/file-scope-guard.test.ts              |  53 ++++++++
 scripts/ci/file-scope-guard.ts                   |  19 ++-
 scripts/ci/scope-override-comment-parser.test.ts |  70 ++++++++++
 scripts/ci/scope-override-comment-parser.ts      |  59 ++++++++
 16 files changed, 600 insertions(+), 13 deletions(-)
```

## Git Name Status
```
M	.github/workflows/file-scope-lock-check.yml
M	.lane/lanes/governance.yml
A	.ops/sync/UTV2-1524.yml
M	docs/06_status/KNOWN_DEBT.md
A	docs/06_status/UTV2-1524-EVIDENCE-BUNDLE.md
A	docs/06_status/evidence/UTV2-1524/.gitkeep
A	docs/06_status/lanes/UTV2-1524.json
A	docs/06_status/proof/UTV2-1524/.gitkeep
A	docs/06_status/proof/UTV2-1524/diff-summary.md
A	docs/06_status/proof/UTV2-1524/evidence.json
A	docs/06_status/proof/UTV2-1524/verification.md
M	package.json
M	scripts/ci/file-scope-guard.test.ts
M	scripts/ci/file-scope-guard.ts
A	scripts/ci/scope-override-comment-parser.test.ts
A	scripts/ci/scope-override-comment-parser.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 79677ab6b491a0e6bc10594df692d6ccf0e92ce0
Merge SHA: N/A
