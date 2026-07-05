# UTV2-1473 Diff Summary

Issue: UTV2-1473
Tier: T1
Branch: claude/utv2-1473-preflight-pb2-flake

## Summary

Root-caused and fixed the PB2 (`pnpm test`) failures under `pnpm ops:preflight ... --tier T1` that were blocking a queued T1 lane's dispatch. Not a flake: five test files silently depend on the caller's ambient shell environment (specifically, whichever `local.env`-sourced values happen to be exported) for delivery-target routing and Supabase persistence-mode decisions, without isolating themselves the way sibling test files in the same codebase already do (`distribution-service.test.ts`). Sourcing `local.env` — which T1 preflight's own PT1 Supabase health check requires — silently changes their outcomes.

Fixed by adding file-scoped save/delete/restore of the specific ambient env keys each file's assertions depend on, matching the established isolation pattern already used elsewhere in the codebase. No production/runtime code changed — test files only.

## Files Changed

- `apps/api/src/submission-service.test.ts` — isolate `UNIT_TALK_APP_ENV` / `UNIT_TALK_DISTRIBUTION_TARGETS` / `UNIT_TALK_ENABLED_TARGETS`
- `apps/api/src/server.test.ts` — same, for requeue + routing-preview route tests
- `apps/api/src/qa-seed.test.ts` — same, for sandbox seed-pick enqueue test
- `apps/worker/src/worker-runtime.test.ts` — extend an existing fixture test's save/restore list with `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- `packages/config/src/env.test.ts` — isolate every env key its 4 fixture-based tests assert on, including `SGO_API_KEYS`

## PM revision (round 2)

PM_VERDICT: CHANGES_REQUIRED flagged two remaining ambient-env gaps: `UNIT_TALK_ENABLED_TARGETS` (read by `resolveTargetRegistry` in `packages/contracts/src/promotion.ts`, gates whether a promotion target is considered enabled at all) was not isolated in `submission-service.test.ts` / `server.test.ts`, and `SGO_API_KEYS` (read directly by `collectConfiguredSgoApiKeys` in `packages/config/src/env.ts`, distinct from the already-isolated singular `SGO_API_KEY`) was not isolated in `env.test.ts`. Both added; all three files re-verified (126/126 local subset, 3x clean full `pnpm test`, PB2 preflight pass).

## R-Level

`docs/05_operations/r1-r5-rules.json` was checked. Test-file-only changes with no runtime/domain/migration/contracts paths touched — no R1-R5 artifacts required.
