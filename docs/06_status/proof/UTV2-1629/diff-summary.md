# UTV2-1629 Diff Summary

Generated at: 2026-07-31T00:15:08.348Z
Issue: UTV2-1629
Tier: T1
Lane type: governance
Branch: claude/utv2-1629-residual-production-credentials
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1325
Head SHA: ae5828c8f2a25801101e77e3a9343cba7e503267
Merge SHA: ae5828c8f2a25801101e77e3a9343cba7e503267
Diff base: ae5828c8f2a25801101e77e3a9343cba7e503267^1
Diff target: ae5828c8f2a25801101e77e3a9343cba7e503267

## Git Diff Stat
```
.github/actions/supabase-pooler-url/action.yml     |  42 ++-
 .github/workflows/live-schema-parity.yml           |  17 +-
 .github/workflows/shadow-parity-required.yml       |  29 +-
 .github/workflows/supabase-pr-db-branch.yml        | 246 ----------------
 .lane/lanes/governance.yml                         |   9 +
 .ops/sync/UTV2-1629.yml                            |  10 +
 docs/05_operations/REQUIRED_CI_CHECKS.md           |  10 +-
 docs/05_operations/REQUIRED_SECRETS.md             |  22 +-
 docs/05_operations/supabase_setup.md               |  36 ++-
 docs/06_status/lanes/UTV2-1629.json                |  80 ++++++
 docs/06_status/proof/UTV2-1629/evidence.json       | 178 ++++++++++++
 docs/06_status/proof/UTV2-1629/verification.md     | 312 +++++++++++++++++++++
 docs/ops/SUPABASE_PREVIEW_BRANCH_VALIDATION.md     |  19 ++
 package.json                                       |   2 +-
 .../workflow-production-credential-guard.test.ts   |  91 +++++-
 scripts/ci/workflow-production-credential-guard.ts | 113 ++++++--
 scripts/ops/ci-proof.ts                            |  11 +-
 scripts/shadow-scoring-runner.test.ts              |  30 ++
 scripts/shadow-scoring-runner.ts                   |  71 ++++-
 19 files changed, 1020 insertions(+), 308 deletions(-)
```

## Git Name Status
```
M	.github/actions/supabase-pooler-url/action.yml
M	.github/workflows/live-schema-parity.yml
M	.github/workflows/shadow-parity-required.yml
D	.github/workflows/supabase-pr-db-branch.yml
M	.lane/lanes/governance.yml
A	.ops/sync/UTV2-1629.yml
M	docs/05_operations/REQUIRED_CI_CHECKS.md
M	docs/05_operations/REQUIRED_SECRETS.md
M	docs/05_operations/supabase_setup.md
A	docs/06_status/lanes/UTV2-1629.json
A	docs/06_status/proof/UTV2-1629/evidence.json
A	docs/06_status/proof/UTV2-1629/verification.md
M	docs/ops/SUPABASE_PREVIEW_BRANCH_VALIDATION.md
M	package.json
M	scripts/ci/workflow-production-credential-guard.test.ts
M	scripts/ci/workflow-production-credential-guard.ts
M	scripts/ops/ci-proof.ts
M	scripts/shadow-scoring-runner.test.ts
M	scripts/shadow-scoring-runner.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: ae5828c8f2a25801101e77e3a9343cba7e503267
Merge SHA: ae5828c8f2a25801101e77e3a9343cba7e503267
