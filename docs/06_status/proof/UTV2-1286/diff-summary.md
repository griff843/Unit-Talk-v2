# UTV2-1286 Diff Summary

Generated at: 2026-06-22T00:20:30.763Z
Issue: UTV2-1286
Tier: T1
Lane type: runtime
Branch: griffadavi/utv2-1286-fix-ingestor-watchdog-false-positive-restarts-during-slow
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1037
Head SHA: 28121b4e5301488ecde303d9ef89045924e78c7c
Merge SHA: 2b50bf5925cfc667ec6226c710a36c739f6da128
Diff base: 2b50bf5925cfc667ec6226c710a36c739f6da128^1
Diff target: 2b50bf5925cfc667ec6226c710a36c739f6da128

## Git Diff Stat
```
.ops/sync/UTV2-1286.yml                            |  10 ++
 apps/ingestor/src/heartbeat.test.ts                |  18 ++++
 apps/ingestor/src/heartbeat.ts                     |  93 +++++++++++++++++--
 apps/ingestor/src/index.ts                         |  48 ++++++----
 apps/ingestor/src/ingestor-loop-resilience.test.ts | 101 ++++++++++++++++++++-
 apps/ingestor/src/ingestor-runner.ts               |  59 +++++++++---
 docs/06_status/lanes/UTV2-1286.json                |  42 +++++++++
 docs/06_status/proof/UTV2-1286/diff-summary.md     |  42 +++++++++
 docs/06_status/proof/UTV2-1286/evidence.json       |  86 ++++++++++++++++++
 docs/06_status/proof/UTV2-1286/verification.md     |  90 ++++++++++++++++++
 10 files changed, 548 insertions(+), 41 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1286.yml
M	apps/ingestor/src/heartbeat.test.ts
M	apps/ingestor/src/heartbeat.ts
M	apps/ingestor/src/index.ts
M	apps/ingestor/src/ingestor-loop-resilience.test.ts
M	apps/ingestor/src/ingestor-runner.ts
A	docs/06_status/lanes/UTV2-1286.json
A	docs/06_status/proof/UTV2-1286/diff-summary.md
A	docs/06_status/proof/UTV2-1286/evidence.json
A	docs/06_status/proof/UTV2-1286/verification.md
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 28121b4e5301488ecde303d9ef89045924e78c7c
Merge SHA: 2b50bf5925cfc667ec6226c710a36c739f6da128
