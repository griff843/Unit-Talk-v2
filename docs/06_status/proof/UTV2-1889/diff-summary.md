# UTV2-1889 Diff Summary

Generated at: 2026-09-12T19:14:27.000Z
Issue: UTV2-1889
Tier: T1
Lane type: runtime
Branch: claude/utv2-1889-operator-attested-results
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1567
Head SHA: 9e3554df42a99c90d41b0c153adfd018beeeb3d2
Merge SHA: N/A
Diff base: 1399f83ed28ec633b5f806555b21d4cc981888ba
Diff target: 9e3554df42a99c90d41b0c153adfd018beeeb3d2

## Git Diff Stat
```
.ops/sync/UTV2-1889.yml                                     | 437 +++++++++++++++++++
apps/api/src/grading-service.test.ts                        | 556 +++++++++++++++++++++++-
apps/api/src/grading-service.ts                             | 161 +++++--
apps/ingestor/src/ingestor.test.ts                          |  35 +-
apps/ingestor/src/results-resolver.test.ts                  | 180 ++++++++
apps/ingestor/src/results-resolver.ts                       | 161 ++++++-
docs/06_status/lanes/UTV2-1889.json                         |  42 ++
docs/06_status/proof/UTV2-1889/diff-summary.md              |  48 +++
docs/06_status/proof/UTV2-1889/evidence.json                | 476 +++++++++++++++++++++
docs/06_status/proof/UTV2-1889/verification.md              | 400 +++++++++++++++++
package.json                                                |   2 +-
scripts/ops/pick-truth-audit.ts                             |   8 +
scripts/ops/track-only-report.test.ts                       | 422 ++++++++++++++++++
scripts/ops/track-only-report.ts                            |  34 +-
scripts/ops/track-only/sgo-journey-proof.ts                 | 734 ++++++++++++++++++++++++++++++++
scripts/ops/track-only/sgo-journey-staging.t1-proof.test.ts | 330 ++++++++++++++
scripts/ops/track-only/stats.ts                             | 218 ++++++++++
17 files changed, 4175 insertions(+), 69 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1889.yml
M	apps/api/src/grading-service.test.ts
M	apps/api/src/grading-service.ts
M	apps/ingestor/src/ingestor.test.ts
M	apps/ingestor/src/results-resolver.test.ts
M	apps/ingestor/src/results-resolver.ts
A	docs/06_status/lanes/UTV2-1889.json
A	docs/06_status/proof/UTV2-1889/diff-summary.md
A	docs/06_status/proof/UTV2-1889/evidence.json
A	docs/06_status/proof/UTV2-1889/verification.md
M	package.json
M	scripts/ops/pick-truth-audit.ts
M	scripts/ops/track-only-report.test.ts
M	scripts/ops/track-only-report.ts
A	scripts/ops/track-only/sgo-journey-proof.ts
A	scripts/ops/track-only/sgo-journey-staging.t1-proof.test.ts
A	scripts/ops/track-only/stats.ts
```

## Removed since the previous summary
```
D	scripts/ops/track-only/operator-attest-result.ts   (present at ba24e12 and every head through 8c57fc3f4; deleted at 9e3554df42a99c90d41b0c153adfd018beeeb3d2, design preserved at 4701685541)
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 9e3554df42a99c90d41b0c153adfd018beeeb3d2
Merge SHA: N/A
