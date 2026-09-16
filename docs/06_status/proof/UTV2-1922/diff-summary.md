# UTV2-1922 Diff Summary

Generated at: 2026-09-16T21:55:00.000Z
Issue: UTV2-1922
Tier: T1
Lane type: runtime
Branch: claude/utv2-1922-deploy-promotion-transaction
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1591
Head SHA: 3e20a5ffa77f8b1215e029fab01d59dd787617b7
Merge SHA: N/A
Diff base: 37062b2b26d018c84009de88a10ce5c65c0edc39
Diff target: 3e20a5ffa77f8b1215e029fab01d59dd787617b7

## Git Diff Stat
```
 .github/workflows/deploy.yml                       | 351 +++++++-
 .lane/lanes/runtime.yml                            |  13 +
 .ops/sync/UTV2-1922.yml                            | 531 ++++++++++++
 deploy/rollback.sh                                 |  78 +-
 docs/06_status/lanes/UTV2-1922.json                |  39 +
 docs/06_status/proof/UTV2-1922/diff-summary.md     |  48 ++
 docs/06_status/proof/UTV2-1922/evidence.json       | 211 +++++
 docs/06_status/proof/UTV2-1922/runtime-health.json | 217 +++++
 docs/06_status/proof/UTV2-1922/verification.md     | 127 +++
 scripts/ci/nextjs-deploy-wiring.test.ts            | 952 ++++++++++++++++++++-
 10 files changed, 2541 insertions(+), 26 deletions(-)
```

## Git Name Status
```
M	.github/workflows/deploy.yml
M	.lane/lanes/runtime.yml
A	.ops/sync/UTV2-1922.yml
M	deploy/rollback.sh
A	docs/06_status/lanes/UTV2-1922.json
A	docs/06_status/proof/UTV2-1922/diff-summary.md
A	docs/06_status/proof/UTV2-1922/evidence.json
A	docs/06_status/proof/UTV2-1922/runtime-health.json
A	docs/06_status/proof/UTV2-1922/verification.md
M	scripts/ci/nextjs-deploy-wiring.test.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 3e20a5ffa77f8b1215e029fab01d59dd787617b7
Merge SHA: N/A
