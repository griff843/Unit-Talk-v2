# UTV2-1851 Diff Summary

Generated at: 2026-09-07T03:12:17.847Z
Issue: UTV2-1851
Tier: T3
Lane type: governance
Branch: claude/utv2-1851-pt1-route-b-admission
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1528
Head SHA: 5d39a8bbf9c82d9f9571ceb3fdbf620007401c9a
Merge SHA: fae78e3a7156944d893d19f9c3d8816e176c2850
Diff base: fae78e3a7156944d893d19f9c3d8816e176c2850^1
Diff target: fae78e3a7156944d893d19f9c3d8816e176c2850

## Git Diff Stat
```
.ops/sync/UTV2-1851.yml                            | 186 +++++++++++
 .../schemas/preflight_token_v1.schema.json         |   6 +-
 docs/06_status/lanes/UTV2-1851.json                |  38 +++
 .../PT1_CONTAINMENT_ADMISSION_DECISION.md          |  62 +++-
 scripts/ops/preflight.test.ts                      |  85 ++++-
 scripts/ops/preflight.ts                           |  37 ++-
 scripts/ops/shared.test.ts                         | 347 ++++++++++++++++++++-
 scripts/ops/shared.ts                              | 154 ++++++++-
 8 files changed, 882 insertions(+), 33 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1851.yml
M	docs/05_operations/schemas/preflight_token_v1.schema.json
A	docs/06_status/lanes/UTV2-1851.json
M	docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md
M	scripts/ops/preflight.test.ts
M	scripts/ops/preflight.ts
M	scripts/ops/shared.test.ts
M	scripts/ops/shared.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 5d39a8bbf9c82d9f9571ceb3fdbf620007401c9a
Merge SHA: fae78e3a7156944d893d19f9c3d8816e176c2850
