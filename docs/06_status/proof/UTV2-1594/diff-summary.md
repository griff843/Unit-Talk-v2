# UTV2-1594 Diff Summary

Generated at: 2026-07-31T22:18:32.434Z
Issue: UTV2-1594
Tier: T1
Lane type: governance
Branch: codex/utv2-1594-durable-execution-semaphore
PR URL: N/A
Head SHA: 03f6ce4dd4abf704f9161babf1b9ee1b8fa50e30
Merge SHA: c08548f1155f011f30a446986949b2b4d5d59b38
Diff base: c08548f1155f011f30a446986949b2b4d5d59b38^1
Diff target: c08548f1155f011f30a446986949b2b4d5d59b38

## Git Diff Stat
```
.ops/sync/UTV2-1594.yml                        |   11 +
 docs/06_status/lanes/UTV2-1594.json            |   49 +
 docs/06_status/proof/UTV2-1594/evidence.json   |  369 ++++++++
 docs/06_status/proof/UTV2-1594/verification.md |  561 +++++++++++
 docs/governance/LANE_CONCURRENCY_POLICY.md     |   45 +-
 package.json                                   |    4 +-
 scripts/ops/codex-exec.test.ts                 |  102 +-
 scripts/ops/codex-exec.ts                      |  194 +++-
 scripts/ops/execution-checkpoint.test.ts       |  478 ++++++++++
 scripts/ops/execution-checkpoint.ts            |  810 ++++++++++++++++
 scripts/ops/lane-maximizer.ts                  |   47 +-
 scripts/ops/preflight.test.ts                  |  146 +--
 scripts/ops/preflight.ts                       |  136 +--
 scripts/ops/verify-semaphore.test.ts           |  934 +++++++++++++++++++
 scripts/ops/verify-semaphore.ts                | 1187 ++++++++++++++++++++++++
 15 files changed, 4842 insertions(+), 231 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1594.yml
A	docs/06_status/lanes/UTV2-1594.json
A	docs/06_status/proof/UTV2-1594/evidence.json
A	docs/06_status/proof/UTV2-1594/verification.md
M	docs/governance/LANE_CONCURRENCY_POLICY.md
M	package.json
M	scripts/ops/codex-exec.test.ts
M	scripts/ops/codex-exec.ts
A	scripts/ops/execution-checkpoint.test.ts
A	scripts/ops/execution-checkpoint.ts
M	scripts/ops/lane-maximizer.ts
M	scripts/ops/preflight.test.ts
M	scripts/ops/preflight.ts
A	scripts/ops/verify-semaphore.test.ts
A	scripts/ops/verify-semaphore.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 03f6ce4dd4abf704f9161babf1b9ee1b8fa50e30
Merge SHA: c08548f1155f011f30a446986949b2b4d5d59b38
