# UTV2-1524 Diff Summary

Generated at: 2026-07-13T10:54:12.511Z
Issue: UTV2-1524
Tier: T1
Lane type: governance
Branch: claude/utv2-1524-scope-override-parser-fix
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1194
Head SHA: 1bebb8ad0251e22577ba3cc958a1ff9e8f17a063
Merge SHA: 60a2a15028aad049e8ff0f3c8c10da5275879ebb
Diff base: 60a2a15028aad049e8ff0f3c8c10da5275879ebb^1
Diff target: 60a2a15028aad049e8ff0f3c8c10da5275879ebb

## Git Diff Stat
```
.github/workflows/file-scope-lock-check.yml      |  28 ++-
 .lane/lanes/governance.yml                       |   7 +
 .ops/sync/UTV2-1524.yml                          |  10 +
 docs/06_status/KNOWN_DEBT.md                     |   5 +-
 docs/06_status/UTV2-1524-EVIDENCE-BUNDLE.md      | 236 +++++++++++++++++++++++
 docs/06_status/evidence/UTV2-1524/.gitkeep       |   0
 docs/06_status/lanes/UTV2-1524.json              |  48 +++++
 docs/06_status/proof/UTV2-1524/.gitkeep          |   0
 docs/06_status/proof/UTV2-1524/diff-summary.md   |  60 ++++++
 docs/06_status/proof/UTV2-1524/evidence.json     |  63 ++++++
 docs/06_status/proof/UTV2-1524/verification.md   |  45 +++++
 package.json                                     |   2 +-
 scripts/ci/file-scope-guard.test.ts              | 192 ++++++++++++++++++
 scripts/ci/file-scope-guard.ts                   |  76 ++++++--
 scripts/ci/scope-override-comment-parser.test.ts |  70 +++++++
 scripts/ci/scope-override-comment-parser.ts      |  59 ++++++
 16 files changed, 877 insertions(+), 24 deletions(-)
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
Head SHA: 1bebb8ad0251e22577ba3cc958a1ff9e8f17a063
Merge SHA: 60a2a15028aad049e8ff0f3c8c10da5275879ebb
