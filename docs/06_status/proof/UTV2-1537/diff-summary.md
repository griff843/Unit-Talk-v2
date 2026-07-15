# UTV2-1537 Diff Summary

Generated at: 2026-07-15T16:46:17.757Z
Issue: UTV2-1537
Tier: T1
Lane type: governance
Branch: claude/utv2-1537-direct-main-incident
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1219
Head SHA: dfe271282489219a8e792f3b4990047e70906e5a
Merge SHA: b5a989d0c827b115be7871a134c8428eb17aa712
Diff base: b5a989d0c827b115be7871a134c8428eb17aa712^1
Diff target: b5a989d0c827b115be7871a134c8428eb17aa712

## Git Diff Stat
```
.github/workflows/direct-main-push-guard.yml       |  96 +++++
 .github/workflows/post-merge-lane-close.yml        |  24 +-
 .ops/sync/UTV2-1537.yml                            |  12 +
 docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md    |   2 +
 .../INC-2026-07-14-utv2-1533-direct-main-push.md   | 183 +++++++++
 docs/06_status/INCIDENTS/README.md                 |   1 +
 docs/06_status/lanes/UTV2-1537.json                |  68 ++++
 docs/06_status/proof/UTV2-1537/evidence.json       | 148 +++++++
 docs/06_status/proof/UTV2-1537/verification.md     | 138 +++++++
 package.json                                       |   3 +-
 scripts/ci/direct-main-push-guard.test.ts          | 187 +++++++++
 scripts/ci/direct-main-push-guard.ts               | 298 ++++++++++++++
 scripts/ops/lane-close.test.ts                     | 169 ++++++++
 scripts/ops/lane-close.ts                          | 142 ++++++-
 scripts/ops/proof-repair.test.ts                   | 302 +++++++++++++++
 scripts/ops/proof-repair.ts                        | 427 +++++++++++++++++++++
 scripts/ops/truth-check-lib.test.ts                | 125 +++++-
 scripts/ops/truth-check-lib.ts                     |  36 ++
 18 files changed, 2356 insertions(+), 5 deletions(-)
```

## Git Name Status
```
A	.github/workflows/direct-main-push-guard.yml
M	.github/workflows/post-merge-lane-close.yml
A	.ops/sync/UTV2-1537.yml
M	docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md
A	docs/06_status/INCIDENTS/INC-2026-07-14-utv2-1533-direct-main-push.md
M	docs/06_status/INCIDENTS/README.md
A	docs/06_status/lanes/UTV2-1537.json
A	docs/06_status/proof/UTV2-1537/evidence.json
A	docs/06_status/proof/UTV2-1537/verification.md
M	package.json
A	scripts/ci/direct-main-push-guard.test.ts
A	scripts/ci/direct-main-push-guard.ts
M	scripts/ops/lane-close.test.ts
M	scripts/ops/lane-close.ts
A	scripts/ops/proof-repair.test.ts
A	scripts/ops/proof-repair.ts
M	scripts/ops/truth-check-lib.test.ts
M	scripts/ops/truth-check-lib.ts
```

## Manifest Files Changed
- .github/workflows/direct-main-push-guard.yml
- .github/workflows/post-merge-lane-close.yml
- .lane/lanes/governance.yml
- docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md
- docs/06_status/INCIDENTS/INC-2026-07-14-utv2-1533-direct-main-push.md
- docs/06_status/INCIDENTS/README.md
- docs/06_status/lanes/UTV2-1537.json
- package.json
- scripts/ci/direct-main-push-guard.test.ts
- scripts/ci/direct-main-push-guard.ts
- scripts/ops/lane-close.test.ts
- scripts/ops/lane-close.ts
- scripts/ops/proof-repair.test.ts
- scripts/ops/proof-repair.ts
- scripts/ops/truth-check-lib.test.ts
- scripts/ops/truth-check-lib.ts

## SHA Binding
Head SHA: dfe271282489219a8e792f3b4990047e70906e5a
Merge SHA: b5a989d0c827b115be7871a134c8428eb17aa712
