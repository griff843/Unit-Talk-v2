# UTV2-1618 Diff Summary

Generated at: 2026-08-01T18:01:02.340Z
Issue: UTV2-1618
Tier: T1
Lane type: governance
Branch: claude/utv2-1618-readonly-diagnostic-hardening
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1314
Head SHA: 9eb150fec673e4acf722d26bd1dfe18d1c734c30
Merge SHA: 147462572b46d80b18c38d3960053ccc272ba087
Diff base: 147462572b46d80b18c38d3960053ccc272ba087^1
Diff target: 147462572b46d80b18c38d3960053ccc272ba087

## Git Diff Stat
```
.github/workflows/deploy.yml                   | 466 +++++++++++++++++++++++--
 .github/workflows/ops-api-diagnose.yml         | 254 +++++++++++---
 .github/workflows/ops-p0-containment.yml       |  20 +-
 .ops/sync/UTV2-1618.yml                        |  10 +
 docs/06_status/lanes/UTV2-1618.json            |  54 +++
 docs/06_status/proof/UTV2-1618/evidence.json   |  85 +++++
 docs/06_status/proof/UTV2-1618/verification.md | 253 ++++++++++++++
 package.json                                   |   2 +-
 scripts/ci/deploy-parked-mode.test.ts          | 351 ++++++++++++++++++-
 scripts/ci/ops-api-diagnose-workflow.test.ts   | 332 ++++++++++++++++++
 scripts/ci/ops-p0-containment-workflow.test.ts |  34 +-
 11 files changed, 1774 insertions(+), 87 deletions(-)
```

## Git Name Status
```
M	.github/workflows/deploy.yml
M	.github/workflows/ops-api-diagnose.yml
M	.github/workflows/ops-p0-containment.yml
A	.ops/sync/UTV2-1618.yml
A	docs/06_status/lanes/UTV2-1618.json
A	docs/06_status/proof/UTV2-1618/evidence.json
A	docs/06_status/proof/UTV2-1618/verification.md
M	package.json
M	scripts/ci/deploy-parked-mode.test.ts
A	scripts/ci/ops-api-diagnose-workflow.test.ts
M	scripts/ci/ops-p0-containment-workflow.test.ts
```

## Manifest Files Changed
- .github/workflows/ops-api-diagnose.yml
- .github/workflows/ops-p0-containment.yml
- .ops/sync/UTV2-1618.yml
- docs/06_status/lanes/UTV2-1618.json
- docs/06_status/proof/UTV2-1618/evidence.json
- docs/06_status/proof/UTV2-1618/verification.md
- package.json
- scripts/ci/ops-api-diagnose-workflow.test.ts
- scripts/ci/ops-p0-containment-workflow.test.ts

## SHA Binding
Head SHA: 9eb150fec673e4acf722d26bd1dfe18d1c734c30
Merge SHA: 147462572b46d80b18c38d3960053ccc272ba087
