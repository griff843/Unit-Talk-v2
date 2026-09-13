# UTV2-1889 Diff Summary

Generated at: 2026-09-13T03:16:30.000Z
Issue: UTV2-1889
Tier: T1
Lane type: runtime
Branch: claude/utv2-1889-operator-attested-results
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1567
Head SHA: 6e923aa3455334bb7ddc2e15fbdba3474bf493f1
Merge SHA: N/A
Diff base: e0c8f812db065035af952ceb5111e2bcd443fbbb (merge-base with origin/main after the resync)
Diff target: 6e923aa3455334bb7ddc2e15fbdba3474bf493f1

## Git Diff Stat
```
 .ops/sync/UTV2-1889.yml                                     | 437 +++++++++++++++++++++++++++++++
 apps/api/src/grading-service.test.ts                        | 556 ++++++++++++++++++++++++++++++++++++++-
 apps/api/src/grading-service.ts                             | 161 ++++++++++--
 apps/ingestor/src/ingestor.test.ts                          |  35 +--
 apps/ingestor/src/results-resolver.test.ts                  | 180 +++++++++++++
 apps/ingestor/src/results-resolver.ts                       | 161 ++++++++++--
 docs/06_status/lanes/UTV2-1889.json                         |  64 +++++
 docs/06_status/proof/UTV2-1889/evidence.json                | 464 +++++++++++++++++++++++++++++++++
 docs/06_status/proof/UTV2-1889/verification.md              | 410 +++++++++++++++++++++++++++++
 package.json                                                |   2 +-
 scripts/ops/pick-truth-audit.ts                             |   8 +
 scripts/ops/track-only-report.test.ts                       | 422 ++++++++++++++++++++++++++++++
 scripts/ops/track-only-report.ts                            |  34 ++-
 scripts/ops/track-only/sgo-journey-proof.ts                 | 734 ++++++++++++++++++++++++++++++++++++++++++++++++++++
 scripts/ops/track-only/sgo-journey-staging.t1-proof.test.ts | 330 +++++++++++++++++++++++
 scripts/ops/track-only/stats.ts                             | 218 ++++++++++++++++
 16 files changed, 4147 insertions(+), 69 deletions(-)
```
(`git diff --stat origin/main` at the final head, excluding this file, whose own edit cannot be counted before it is committed.)

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
- .ops/sync/UTV2-1889.yml
- apps/api/src/grading-service.test.ts
- apps/api/src/grading-service.ts
- apps/ingestor/src/ingestor.test.ts
- apps/ingestor/src/results-resolver.test.ts
- apps/ingestor/src/results-resolver.ts
- docs/06_status/lanes/UTV2-1889.json
- docs/06_status/proof/UTV2-1889/diff-summary.md
- docs/06_status/proof/UTV2-1889/evidence.json
- docs/06_status/proof/UTV2-1889/verification.md
- package.json
- scripts/ops/pick-truth-audit.ts
- scripts/ops/track-only-report.test.ts
- scripts/ops/track-only-report.ts
- scripts/ops/track-only/sgo-journey-proof.ts
- scripts/ops/track-only/sgo-journey-staging.t1-proof.test.ts
- scripts/ops/track-only/stats.ts

## SHA Binding
Head SHA: 6e923aa3455334bb7ddc2e15fbdba3474bf493f1
Merge SHA: N/A
