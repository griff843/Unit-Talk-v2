# UTV2-1889 Diff Summary

Generated at: 2026-09-11T21:36:27.051Z
Issue: UTV2-1889
Tier: T1
Lane type: runtime
Branch: claude/utv2-1889-operator-attested-results
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1567
Head SHA: ba24e12158a84d314ecba228c536944c586bac9d
Merge SHA: N/A
Diff base: 34a8e22e687e47b9cf452f5694de5d132899842a
Diff target: ba24e12158a84d314ecba228c536944c586bac9d

## Git Diff Stat
```
.ops/sync/UTV2-1889.yml                          | 437 +++++++++++++++++++
 apps/api/src/grading-service.test.ts             | 395 ++++++++++++++++-
 apps/api/src/grading-service.ts                  | 139 +++++-
 docs/06_status/lanes/UTV2-1889.json              |  42 ++
 docs/06_status/proof/UTV2-1889/.gitkeep          |   0
 scripts/ops/pick-truth-audit.ts                  |   8 +
 scripts/ops/track-only-report.test.ts            | 526 +++++++++++++++++++++++
 scripts/ops/track-only-report.ts                 |  25 +-
 scripts/ops/track-only/operator-attest-result.ts | 447 +++++++++++++++++++
 scripts/ops/track-only/stats.ts                  | 218 ++++++++++
 10 files changed, 2212 insertions(+), 25 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1889.yml
M	apps/api/src/grading-service.test.ts
M	apps/api/src/grading-service.ts
A	docs/06_status/lanes/UTV2-1889.json
A	docs/06_status/proof/UTV2-1889/.gitkeep
M	scripts/ops/pick-truth-audit.ts
M	scripts/ops/track-only-report.test.ts
M	scripts/ops/track-only-report.ts
A	scripts/ops/track-only/operator-attest-result.ts
A	scripts/ops/track-only/stats.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: ba24e12158a84d314ecba228c536944c586bac9d
Merge SHA: N/A
