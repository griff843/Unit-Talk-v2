# UTV2-1589 Diff Summary

Generated at: 2026-07-26T00:19:52.939Z
Issue: UTV2-1589
Tier: T1
Lane type: governance
Branch: codex/utv2-1589-model-routing-sha-bind
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1308
Head SHA: 2af8fb45ed2883dfc82e2051cd028b27bd7f71f9
Merge SHA: 6f0c3616be06ae86d7ca48da8430109a776193a5
Diff base: 6f0c3616be06ae86d7ca48da8430109a776193a5^1
Diff target: 6f0c3616be06ae86d7ca48da8430109a776193a5

## Git Diff Stat
```
.github/workflows/post-merge-lane-close.yml       |   70 +-
 .ops/sync/UTV2-1589.yml                           |   10 +
 docs/06_status/lanes/UTV2-1589.json               |   51 +
 docs/06_status/proof/UTV2-1589/evidence.json      |  261 ++++++
 docs/06_status/proof/UTV2-1589/model-routing.json |   14 +
 docs/06_status/proof/UTV2-1589/verification.md    |  505 ++++++++++
 scripts/ops/lane-close.test.ts                    |  617 +++++++++++++
 scripts/ops/lane-close.ts                         |  104 ++-
 scripts/ops/proof-generate.test.ts                | 1027 +++++++++++++++++++++
 scripts/ops/proof-generate.ts                     |  421 ++++++++-
 scripts/ops/truth-check-lib.test.ts               |   68 ++
 11 files changed, 3130 insertions(+), 18 deletions(-)
```

## Git Name Status
```
M	.github/workflows/post-merge-lane-close.yml
A	.ops/sync/UTV2-1589.yml
A	docs/06_status/lanes/UTV2-1589.json
A	docs/06_status/proof/UTV2-1589/evidence.json
A	docs/06_status/proof/UTV2-1589/model-routing.json
A	docs/06_status/proof/UTV2-1589/verification.md
M	scripts/ops/lane-close.test.ts
M	scripts/ops/lane-close.ts
M	scripts/ops/proof-generate.test.ts
M	scripts/ops/proof-generate.ts
M	scripts/ops/truth-check-lib.test.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 2af8fb45ed2883dfc82e2051cd028b27bd7f71f9
Merge SHA: 6f0c3616be06ae86d7ca48da8430109a776193a5
