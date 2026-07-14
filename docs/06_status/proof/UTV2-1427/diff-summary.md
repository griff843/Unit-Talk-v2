# UTV2-1427 Diff Summary

## Change

Adds a live, DB-backed, no-code-deploy delivery kill switch for governed Discord targets (`best-bets`, `trader-insights`, `exclusive-insights`), plus a fail-loud ops alert webhook health check.

## Files changed

- `supabase/migrations/20260714120000_add_delivery_kill_switch.sql` (new) — `delivery_kill_switch` table
- `packages/db/src/database.types.ts` — regenerated against an applied migration on an isolated Supabase dev branch (deleted after use); no longer hand-authored
- `db/migrations-rollback/20260714120000_add_delivery_kill_switch.down.sql` (new) — down script required by `migration-reversibility-gate.yml`
- `apps/api/src/t1-proof-utv2-1427-kill-switch.test.ts` (new) — live-DB proof for `DatabaseDeliveryKillSwitchRepository`, required by `proof-coverage-guard.yml`
- `docs/06_status/proof/UTV2-1427/evidence.json` (new) — schema v2 proof binding required by `migration-reversibility-gate.yml`
- `packages/db/src/repositories.ts` — `DeliveryKillSwitchRepository` interface, `RepositoryBundle.killSwitch`
- `packages/db/src/runtime-repositories.ts` — `InMemoryDeliveryKillSwitchRepository`, `DatabaseDeliveryKillSwitchRepository`, wired into both factory functions
- `apps/worker/src/distribution-worker.ts` — `WorkerProcessKillSwitchEngagedResult` type
- `apps/worker/src/runner.ts` — kill-switch check per governed target, before claim
- `apps/worker/src/worker-runtime.test.ts` — 3 new tests
- `apps/api/src/routes/kill-switch.ts` (new) — `GET`/`POST /api/discord/kill-switch`
- `apps/api/src/routes/kill-switch.test.ts` (new) — 4 tests
- `apps/api/src/routes/index.ts`, `apps/api/src/server.ts` — route registration
- `apps/api/src/auth.ts` — `operator`-only ROUTE_ROLES entry
- `apps/api/src/routes/health.ts` — ops alert webhook fail-loud check
- `apps/command-center/src/lib/data/discord-ops.ts` — `getDeliveryKillSwitchStatuses()`
- `apps/command-center/src/app/operations/discord/actions.ts` (new), `KillSwitchPanel.tsx` (new), `page.tsx` — Command Center widget
- `docs/05_operations/DELIVERY_KILL_SWITCH.md` (new), `docs/05_operations/PROMOTION_TARGET_REGISTRY_CONTRACT.md` — docs

## Merge order

Standalone. No dependency on any other currently-open lane.

## The one production-consequential item

This lane does not flip `best-bets`/`trader-insights` from their current `enabled: true` default in `packages/contracts/src/promotion.ts` — see `verification.md`'s routing note and `DELIVERY_KILL_SWITCH.md` §5. That flip is deliberately left for a follow-up gated on explicit PM sign-off at merge time, not bundled into this PR's default state.

## Migration applied to production (PM-approved)

`20260714120000_add_delivery_kill_switch.sql` was applied directly to the live Supabase project (`zfzdnfwdarxucxtaojxm`) with PM sign-off, after a genuine live-DB proof test revealed it had only ever run against a temporary, since-deleted dev branch. See `verification.md`'s "PM review round 2 — live-DB proof" section.
