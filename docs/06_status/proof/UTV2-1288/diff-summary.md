# UTV2-1288 Diff Summary

Generated at: 2026-06-22T23:03:08.225Z
Issue: UTV2-1288
Tier: T1
Lane type: runtime
Branch: claude/utv2-1288-harden-ingestor-startup-chain
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1042
Head SHA: fde48c7479a19a1636e2aa650cb7a8d1e9cdec3d
Merge SHA: 99006b7bb3634603b97b582c661395dbd52d01ba
Diff base: 99006b7bb3634603b97b582c661395dbd52d01ba^1
Diff target: 99006b7bb3634603b97b582c661395dbd52d01ba

## Git Diff Stat
```
.ops/sync/UTV2-1288.yml                        |  10 ++
 apps/ingestor/src/index.ts                     | 114 +++++++++++++++++-----
 apps/ingestor/src/startup-resilience.test.ts   | 126 +++++++++++++++++++++++++
 apps/ingestor/src/startup-resilience.ts        | 114 ++++++++++++++++++++++
 docs/06_status/lanes/UTV2-1288.json            |  42 +++++++++
 docs/06_status/proof/UTV2-1288/diff-summary.md |  22 +++++
 docs/06_status/proof/UTV2-1288/evidence.json   |  46 +++++++++
 docs/06_status/proof/UTV2-1288/verification.md | 103 ++++++++++++++++++++
 8 files changed, 553 insertions(+), 24 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1288.yml
M	apps/ingestor/src/index.ts
A	apps/ingestor/src/startup-resilience.test.ts
A	apps/ingestor/src/startup-resilience.ts
A	docs/06_status/lanes/UTV2-1288.json
A	docs/06_status/proof/UTV2-1288/diff-summary.md
A	docs/06_status/proof/UTV2-1288/evidence.json
A	docs/06_status/proof/UTV2-1288/verification.md
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: fde48c7479a19a1636e2aa650cb7a8d1e9cdec3d
Merge SHA: 99006b7bb3634603b97b582c661395dbd52d01ba
