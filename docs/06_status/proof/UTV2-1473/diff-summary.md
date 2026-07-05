# UTV2-1473 Diff Summary

Generated at: 2026-07-05T20:12:22.781Z
Issue: UTV2-1473
Tier: T1
Lane type: runtime
Branch: claude/utv2-1473-preflight-pb2-flake
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1155
Head SHA: c8b6bc17a815736de8b13cbd399421ac6d1c2967
Merge SHA: c8b6bc17a815736de8b13cbd399421ac6d1c2967
Diff base: c8b6bc17a815736de8b13cbd399421ac6d1c2967^1
Diff target: c8b6bc17a815736de8b13cbd399421ac6d1c2967

## Git Diff Stat
```
.ops/sync/UTV2-1473.yml                        | 12 ++++
 apps/api/src/qa-seed.test.ts                   | 33 ++++++++-
 apps/api/src/server.test.ts                    | 47 +++++++++++-
 apps/api/src/submission-service.test.ts        | 54 +++++++++++++-
 apps/worker/src/worker-runtime.test.ts         | 13 ++++
 docs/06_status/lanes/UTV2-1473.json            | 41 +++++++++++
 docs/06_status/proof/UTV2-1473/diff-summary.md | 27 +++++++
 docs/06_status/proof/UTV2-1473/verification.md | 99 ++++++++++++++++++++++++++
 packages/config/src/env.test.ts                | 53 +++++++++++++-
 9 files changed, 375 insertions(+), 4 deletions(-)
```

## Git Name Status
```
A	.ops/sync/UTV2-1473.yml
M	apps/api/src/qa-seed.test.ts
M	apps/api/src/server.test.ts
M	apps/api/src/submission-service.test.ts
M	apps/worker/src/worker-runtime.test.ts
A	docs/06_status/lanes/UTV2-1473.json
A	docs/06_status/proof/UTV2-1473/diff-summary.md
A	docs/06_status/proof/UTV2-1473/verification.md
M	packages/config/src/env.test.ts
```

## Manifest Files Changed
- apps/api/src/qa-seed.test.ts
- apps/api/src/server.test.ts
- apps/api/src/submission-service.test.ts
- apps/worker/src/worker-runtime.test.ts
- packages/config/src/env.test.ts

## SHA Binding
Head SHA: c8b6bc17a815736de8b13cbd399421ac6d1c2967
Merge SHA: c8b6bc17a815736de8b13cbd399421ac6d1c2967

## Summary

Root-caused and fixed the PB2 (`pnpm test`) failures under `pnpm ops:preflight ... --tier T1` that were blocking a queued T1 lane's dispatch. Not a flake: five test files silently depend on the caller's ambient shell environment (specifically, whichever `local.env`-sourced values happen to be exported) for delivery-target routing and Supabase persistence-mode decisions, without isolating themselves the way sibling test files in the same codebase already do (`distribution-service.test.ts`). Sourcing `local.env` — which T1 preflight's own PT1 Supabase health check requires — silently changes their outcomes.

Fixed by adding file-scoped save/delete/restore of the specific ambient env keys each file's assertions depend on, matching the established isolation pattern already used elsewhere in the codebase. No production/runtime code changed — test files only.

## PM revision (round 2)

PM_VERDICT: CHANGES_REQUIRED flagged two remaining ambient-env gaps: `UNIT_TALK_ENABLED_TARGETS` (read by `resolveTargetRegistry` in `packages/contracts/src/promotion.ts`, gates whether a promotion target is considered enabled at all) was not isolated in `submission-service.test.ts` / `server.test.ts`, and `SGO_API_KEYS` (read directly by `collectConfiguredSgoApiKeys` in `packages/config/src/env.ts`, distinct from the already-isolated singular `SGO_API_KEY`) was not isolated in `env.test.ts`. Both added; all three files re-verified (126/126 local subset, 3x clean full `pnpm test`, PB2 preflight pass). PM_VERDICT: APPROVED followed; merged via squash to main (PR #1155).

## R-Level

`docs/05_operations/r1-r5-rules.json` was checked. Test-file-only changes with no runtime/domain/migration/contracts paths touched — no R1-R5 artifacts required.
