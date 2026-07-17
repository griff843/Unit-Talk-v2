# UTV2-1433 Diff Summary

Generated at: 2026-07-15T19:38:59.884Z
Issue: UTV2-1433
Tier: T2
Lane type: hygiene
Branch: codex/utv2-1433-lane-close-lease-release
PR URL: N/A
Head SHA: 728a41725a8df6bee5fa2b62ee36810ed2ed7a15
Merge SHA: N/A
Diff base: 6b6ac71cd6e243ce9469d2e09cb6f61a68c0eec7
Diff target: 728a41725a8df6bee5fa2b62ee36810ed2ed7a15

Rebind note: rebased onto current main and extended on 2026-07-17 to address
two Codex findings (gate default lock release behind an explicit opt-in;
confirm the already-present model-routing.json proof). Diff stat below is
against the current main tip, not the original pre-rebase base.

## Git Diff Stat
```
.ops/sync/UTV2-1433.yml                           | 10 ++
 docs/06_status/lanes/UTV2-1433.json               | 45 +++++++++++
 docs/06_status/proof/UTV2-1433/diff-summary.md    | 40 ++++++++++
 docs/06_status/proof/UTV2-1433/model-routing.json | 14 ++++
 docs/06_status/proof/UTV2-1433/verification.md    | 63 ++++++++++++++++
 scripts/ops/lane-close.test.ts                    | 90 ++++++++++++++++++++---
 scripts/ops/lane-close.ts                         | 20 ++++-
 7 files changed, 270 insertions(+), 12 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1433.yml
A	docs/06_status/lanes/UTV2-1433.json
A	docs/06_status/proof/UTV2-1433/diff-summary.md
A	docs/06_status/proof/UTV2-1433/model-routing.json
A	docs/06_status/proof/UTV2-1433/verification.md
M	scripts/ops/lane-close.test.ts
M	scripts/ops/lane-close.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 728a41725a8df6bee5fa2b62ee36810ed2ed7a15
Merge SHA: N/A
