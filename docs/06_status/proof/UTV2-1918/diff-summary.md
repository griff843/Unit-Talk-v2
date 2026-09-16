# UTV2-1918 Diff Summary

Generated at: 2026-09-16T02:15:39.638Z
Issue: UTV2-1918
Tier: T1
Lane type: runtime
Branch: claude/utv2-1918-cc-deployment-candidate
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1587
Head SHA: 65f7e192396c794d08f0ea1d1bc420b9c8d6dc0a
Merge SHA: N/A
Diff base: b0737442f1cf38de132ba5dd00e6ae4ae5341e66
Diff target: 65f7e192396c794d08f0ea1d1bc420b9c8d6dc0a

## Git Diff Stat
```
.github/workflows/deploy.yml                       | 178 +++++++++-
 .ops/sync/UTV2-1910.yml                            | 234 +++++++++++++
 .ops/sync/UTV2-1918.yml                            | 382 +++++++++++++++++++++
 apps/command-center/src/app/actions/settle.ts      |  48 ++-
 apps/command-center/src/app/settlement/page.tsx    |  13 +
 .../src/components/CorrectionForm.tsx              | 124 ++++++-
 .../src/components/InlineSettleButton.tsx          |  73 ----
 .../src/components/SettlementForm.tsx              | 125 ++++++-
 .../src/components/SettlementWorkbench.tsx         |   3 +
 .../src/lib/operator-grading-context.test.ts       |  84 +++++
 .../src/lib/operator-grading-context.ts            |  72 ++++
 .../src/lib/server-action-guard.test.ts            |  12 +-
 deploy/production/docker-compose.yml               |  47 +++
 deploy/production/nextjs-entrypoint.sh             |  54 +++
 docs/06_status/lanes/UTV2-1910.json                |  53 +++
 docs/06_status/lanes/UTV2-1918.json                |  40 +++
 docs/06_status/proof/UTV2-1910/diff-summary.md     |  50 +++
 docs/06_status/proof/UTV2-1910/evidence.json       | 128 +++++++
 docs/06_status/proof/UTV2-1910/verification.md     |  87 +++++
 scripts/ci/nextjs-deploy-wiring.test.ts            | 299 +++++++++++++++-
 20 files changed, 2008 insertions(+), 98 deletions(-)
```

## Git Name Status
```
M	.github/workflows/deploy.yml
A	.ops/sync/UTV2-1910.yml
A	.ops/sync/UTV2-1918.yml
M	apps/command-center/src/app/actions/settle.ts
M	apps/command-center/src/app/settlement/page.tsx
M	apps/command-center/src/components/CorrectionForm.tsx
D	apps/command-center/src/components/InlineSettleButton.tsx
M	apps/command-center/src/components/SettlementForm.tsx
M	apps/command-center/src/components/SettlementWorkbench.tsx
A	apps/command-center/src/lib/operator-grading-context.test.ts
A	apps/command-center/src/lib/operator-grading-context.ts
M	apps/command-center/src/lib/server-action-guard.test.ts
M	deploy/production/docker-compose.yml
M	deploy/production/nextjs-entrypoint.sh
A	docs/06_status/lanes/UTV2-1910.json
A	docs/06_status/lanes/UTV2-1918.json
A	docs/06_status/proof/UTV2-1910/diff-summary.md
A	docs/06_status/proof/UTV2-1910/evidence.json
A	docs/06_status/proof/UTV2-1910/verification.md
M	scripts/ci/nextjs-deploy-wiring.test.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 65f7e192396c794d08f0ea1d1bc420b9c8d6dc0a
Merge SHA: N/A
