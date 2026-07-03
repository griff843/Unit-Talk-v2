# UTV2-1401 Diff Summary

Generated at: 2026-07-03T02:09:13.425Z
Issue: UTV2-1401
Tier: T2
Lane type: governance
Branch: griffadavi/utv2-1401-ops-harness-hardening-batch
PR URL: N/A
Head SHA: 3a92e3effabaeab3064d7347b93b4aa1d38cb51c
Merge SHA: N/A
Diff base: 7cc9131381b64bac9f3d773328ccc6cf392d2629
Diff target: 3a92e3effabaeab3064d7347b93b4aa1d38cb51c

## Git Diff Stat
```
.claude/hooks/artifact-drift-check.sh     |  12 +--
 .claude/hooks/bash-safety-guard.sh        |   4 +-
 .claude/hooks/pre-proof-validator.sh      |   4 +-
 .claude/hooks/session-start.sh            |  28 ++++-
 .claude/hooks/suggest-test-group.sh       |   2 +-
 .claude/hooks/tier-c-path-guard.sh        |   6 +-
 .env.example                              |   2 +-
 .ops/sync/UTV2-1401.yml                   |  10 ++
 CLAUDE.md                                 |   7 ++
 docs/05_operations/STANDING_GUARDRAILS.md |  15 +++
 docs/06_status/lanes/UTV2-1401.json       |  51 +++++++++
 package.json                              |   2 +-
 scripts/ops/lane-manifest.ts              |  25 +++--
 scripts/ops/lane-start.ts                 |  17 ++-
 scripts/ops/merge-wrapper.test.ts         | 141 ++++++++++++++++++++++++
 scripts/ops/merge-wrapper.ts              | 174 +++++++++++++++++++++++++++++-
 scripts/ops/ops-merge-wrapper.test.ts     | 126 ++++++++++++++++------
 scripts/ops/ops-merge-wrapper.ts          |  47 ++++++--
 scripts/validate-env.mjs                  |  69 +++++++++---
 scripts/validate-env.test.mjs             |  67 ++++++++++++
 20 files changed, 724 insertions(+), 85 deletions(-)
```

## Git Name Status
```
M	.claude/hooks/artifact-drift-check.sh
M	.claude/hooks/bash-safety-guard.sh
M	.claude/hooks/pre-proof-validator.sh
M	.claude/hooks/session-start.sh
M	.claude/hooks/suggest-test-group.sh
M	.claude/hooks/tier-c-path-guard.sh
M	.env.example
A	.ops/sync/UTV2-1401.yml
M	CLAUDE.md
A	docs/05_operations/STANDING_GUARDRAILS.md
A	docs/06_status/lanes/UTV2-1401.json
M	package.json
M	scripts/ops/lane-manifest.ts
M	scripts/ops/lane-start.ts
M	scripts/ops/merge-wrapper.test.ts
M	scripts/ops/merge-wrapper.ts
M	scripts/ops/ops-merge-wrapper.test.ts
M	scripts/ops/ops-merge-wrapper.ts
M	scripts/validate-env.mjs
A	scripts/validate-env.test.mjs
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 3a92e3effabaeab3064d7347b93b4aa1d38cb51c
Merge SHA: N/A
