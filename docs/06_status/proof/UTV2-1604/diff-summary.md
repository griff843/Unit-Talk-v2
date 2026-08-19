# UTV2-1604 Diff Summary

Generated at: 2026-07-31T11:59:00.132Z
Issue: UTV2-1604
Tier: T1
Lane type: runtime
Branch: codex/utv2-1604-parked-mode-scheduler-policy
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1319
Head SHA: 0fe613429527926fd3115da8eb791bd31b1d2197
Merge SHA: 9879d1f97f81ca596822b5debf972d784ee1087b
Diff base: 9879d1f97f81ca596822b5debf972d784ee1087b^1
Diff target: 9879d1f97f81ca596822b5debf972d784ee1087b

## Git Diff Stat
```
.env.example                                      |   4 +-
 .github/workflows/deploy.yml                      |  83 +++++--
 .ops/sync/UTV2-1604.yml                           |  10 +
 apps/api/src/index.ts                             | 284 +++++++++++++---------
 apps/api/src/scheduler-policy.test.ts             | 139 +++++++++++
 apps/api/src/scheduler-policy.ts                  | 121 +++++++++
 docs/06_status/lanes/UTV2-1604.json               |  57 +++++
 docs/06_status/proof/UTV2-1604/.gitkeep           |   0
 docs/06_status/proof/UTV2-1604/evidence.json      | 274 +++++++++++++++++++++
 docs/06_status/proof/UTV2-1604/model-routing.json |  15 ++
 docs/06_status/proof/UTV2-1604/verification.md    | 236 ++++++++++++++++++
 package.json                                      |   4 +-
 packages/config/src/env.test.ts                   |  48 ++++
 packages/config/src/env.ts                        |  33 ++-
 scripts/ci/deploy-parked-mode.test.ts             | 269 ++++++++++++++++++++
 scripts/ci/scheduler-classification.test.ts       | 206 ++++++++++++++++
 16 files changed, 1637 insertions(+), 146 deletions(-)
```

## Git Name Status
```
M	.env.example
M	.github/workflows/deploy.yml
A	.ops/sync/UTV2-1604.yml
M	apps/api/src/index.ts
A	apps/api/src/scheduler-policy.test.ts
A	apps/api/src/scheduler-policy.ts
A	docs/06_status/lanes/UTV2-1604.json
A	docs/06_status/proof/UTV2-1604/.gitkeep
A	docs/06_status/proof/UTV2-1604/evidence.json
A	docs/06_status/proof/UTV2-1604/model-routing.json
A	docs/06_status/proof/UTV2-1604/verification.md
M	package.json
M	packages/config/src/env.test.ts
M	packages/config/src/env.ts
A	scripts/ci/deploy-parked-mode.test.ts
A	scripts/ci/scheduler-classification.test.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 0fe613429527926fd3115da8eb791bd31b1d2197
Merge SHA: 9879d1f97f81ca596822b5debf972d784ee1087b
