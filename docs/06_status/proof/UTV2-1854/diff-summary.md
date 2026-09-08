# UTV2-1854 Diff Summary

Issue: UTV2-1854
Tier: T1
Lane type: runtime
Branch: claude/utv2-1854-reference-data-participants
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1535
Head SHA: 869c0d2c382dda22eb3f57ab71a6ddc9f1ddd8f7
Merge SHA: 79fe3d292ae49348e1d29910716199f1b47a8938
Diff base: 07fbefd8e99a41af9a0cd523f4ed7098a97385be
Diff target: 869c0d2c382dda22eb3f57ab71a6ddc9f1ddd8f7

The base is the merge-base with `origin/main` after `ops:merge-wrapper git-merge-main`, so the
stat below is this lane's own change and excludes everything `main` contributed by that sync.

`docs/06_status/proof/UTV2-1854/**` DOES appear in the stat, and that is a change from the
previous revision of this file, which said it was absent. The reason is honest rather than
cosmetic: the bundle authored at the earlier anchor `a6096fd47` was committed and pushed, and the
proof-fixture correction that produced the current anchor was authored on top of it. The anchor is
still the last **non-proof** commit -- `869c0d2c3`, the correction itself -- and the proof bundle
files in the stat are the earlier revision of this same bundle, now being rewritten at the new
anchor.

## Git Diff Stat
```
 .ops/sync/UTV2-1854.yml                            | 257 +++++++++++++
 apps/api/src/smart-form-validation.test.ts         | 275 +++++++++-----
 apps/api/src/smart-form-validation.ts              |  15 +-
 .../t1-proof-utv2-1842-fallback-event-gate.test.ts | 408 ++++++++++++++++++++-
 docs/06_status/lanes/UTV2-1854.json                |  40 ++
 docs/06_status/proof/UTV2-1854/diff-summary.md     |  43 +++
 docs/06_status/proof/UTV2-1854/evidence.json       | 183 +++++++++
 docs/06_status/proof/UTV2-1854/verification.md     | 122 ++++++
 packages/db/src/canonical-reference-schema.test.ts | 379 +++++++++++++++++++
 packages/db/src/runtime-repositories.ts            | 308 ++++++++++++----
 10 files changed, 1854 insertions(+), 176 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1854.yml
M	apps/api/src/smart-form-validation.test.ts
M	apps/api/src/smart-form-validation.ts
M	apps/api/src/t1-proof-utv2-1842-fallback-event-gate.test.ts
A	docs/06_status/lanes/UTV2-1854.json
A	docs/06_status/proof/UTV2-1854/diff-summary.md
A	docs/06_status/proof/UTV2-1854/evidence.json
A	docs/06_status/proof/UTV2-1854/verification.md
M	packages/db/src/canonical-reference-schema.test.ts
M	packages/db/src/runtime-repositories.ts
```

## SHA Binding
Head SHA: 869c0d2c382dda22eb3f57ab71a6ddc9f1ddd8f7
Merge SHA: 79fe3d292ae49348e1d29910716199f1b47a8938
