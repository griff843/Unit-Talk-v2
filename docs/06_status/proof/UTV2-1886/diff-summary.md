# UTV2-1886 Diff Summary

Generated at: 2026-09-11T12:22:15.372Z
Issue: UTV2-1886
Tier: T1
Lane type: runtime
Branch: claude/utv2-1886-grading-settlement-prefetch
PR URL: N/A
Head SHA: 3d9886e586f15686a0ae1baa310fd615e2d59dbb
Merge SHA: N/A
Diff base: a24cd7bf74a773f010d1ac9e6ef5f112c4183548
Diff target: 3d9886e586f15686a0ae1baa310fd615e2d59dbb

## Git Diff Stat
```
.ops/sync/UTV2-1886.yml                       | 286 ++++++++++++++++++++++++++
 apps/api/src/grading-service.test.ts          | 136 +++++++++---
 apps/api/src/grading-service.ts               |  18 +-
 docs/06_status/lanes/UTV2-1886.json           |  40 ++++
 packages/db/src/repositories.ts               |  14 ++
 packages/db/src/runtime-repositories.ts       | 111 ++++++++++
 packages/db/src/settlement-invariants.test.ts | 163 ++++++++++++++-
 7 files changed, 735 insertions(+), 33 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1886.yml
M	apps/api/src/grading-service.test.ts
M	apps/api/src/grading-service.ts
A	docs/06_status/lanes/UTV2-1886.json
M	packages/db/src/repositories.ts
M	packages/db/src/runtime-repositories.ts
M	packages/db/src/settlement-invariants.test.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 3d9886e586f15686a0ae1baa310fd615e2d59dbb
Merge SHA: N/A
