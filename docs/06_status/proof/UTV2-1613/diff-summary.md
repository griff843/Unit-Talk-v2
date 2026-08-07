# UTV2-1613 Diff Summary

Generated at: 2026-07-31T21:39:17.761Z
Issue: UTV2-1613
Tier: T1
Lane type: governance
Branch: claude/utv2-1613-lane-close-measured-truth
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1339
Head SHA: bda21ecac6c5ae4f17683cddf25bd90bf0ca0c84
Merge SHA: 45ce763fcee28aaf92ffd77d812c2e4dfc2679b3
Diff base: 1a533cbf0057ab2543813f25f16660c9e2189308^1
Diff target: 1a533cbf0057ab2543813f25f16660c9e2189308

## Git Diff Stat
```
.ops/sync/UTV2-1613.yml                        |  12 +
 docs/06_status/lanes/UTV2-1590.json            |  16 +-
 docs/06_status/lanes/UTV2-1613.json            |  50 ++
 docs/06_status/proof/UTV2-1613/evidence.json   | 314 +++++++++++
 docs/06_status/proof/UTV2-1613/verification.md | 391 ++++++++++++++
 package.json                                   |   4 +-
 scripts/ops/lane-close-repair-packet.test.ts   | 472 +++++++++++++++++
 scripts/ops/lane-close-repair-packet.ts        | 704 +++++++++++++++++++++++++
 scripts/ops/lane-close.test.ts                 | 640 +++++++++++++++++++++-
 scripts/ops/lane-close.ts                      | 698 ++++++++++++++++++++++--
 scripts/ops/lane-manifest.test.ts              |  39 +-
 scripts/ops/lane-manifest.ts                   |  65 +--
 scripts/ops/reconcile.test.ts                  | 153 ++++++
 scripts/ops/reconcile.ts                       | 216 +++++++-
 scripts/ops/truth-history-audit.test.ts        | 150 ++++++
 scripts/ops/truth-history-audit.ts             | 164 ++++++
 16 files changed, 3970 insertions(+), 118 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1613.yml
M	docs/06_status/lanes/UTV2-1590.json
A	docs/06_status/lanes/UTV2-1613.json
A	docs/06_status/proof/UTV2-1613/evidence.json
A	docs/06_status/proof/UTV2-1613/verification.md
M	package.json
A	scripts/ops/lane-close-repair-packet.test.ts
A	scripts/ops/lane-close-repair-packet.ts
M	scripts/ops/lane-close.test.ts
M	scripts/ops/lane-close.ts
M	scripts/ops/lane-manifest.test.ts
M	scripts/ops/lane-manifest.ts
M	scripts/ops/reconcile.test.ts
M	scripts/ops/reconcile.ts
A	scripts/ops/truth-history-audit.test.ts
A	scripts/ops/truth-history-audit.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: bda21ecac6c5ae4f17683cddf25bd90bf0ca0c84
Merge SHA: 45ce763fcee28aaf92ffd77d812c2e4dfc2679b3
