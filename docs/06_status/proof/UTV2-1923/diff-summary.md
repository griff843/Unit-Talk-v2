# UTV2-1923 Diff Summary

Generated at: 2026-09-17T23:22:46.000Z
Issue: UTV2-1923
Tier: T1
Lane type: runtime
Branch: claude/utv2-1923-worker-human-target-map-exemption
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1599
Head SHA: 5194341b7576eadf97776b04d12190559487bb2c
Merge SHA: pending merge
Diff base: 616994604292345b9e44cfd0c91339fcbe9bcdef
Diff target: 5194341b7576eadf97776b04d12190559487bb2c

## Git Diff Stat
```
 apps/worker/src/runtime.ts                         |  27 +-
 apps/worker/src/worker-runtime.test.ts             |  44 +++-
 docs/06_status/lanes/UTV2-1923.json                |  61 +----
 docs/06_status/proof/UTV2-1923/evidence.json       | 279 ++++++++-------------
 docs/06_status/proof/UTV2-1923/runtime-health.json | 100 ++++----
 docs/06_status/proof/UTV2-1923/verification.md     | 228 ++++++-----------
 packages/config/src/env.test.ts                    | 203 +++++++++++++++
 packages/config/src/env.ts                         |  77 ++++--
 packages/db/src/client.ts                          |  11 +-
 9 files changed, 574 insertions(+), 456 deletions(-)
```

## What changed, and why

Two defects, both of which only production could surface, both preventing a service from
STARTING. Neither activates anything.

### 1. The `human-capper` worker could not start (increment 2)

`apps/worker/src/runtime.ts` — `assertDiscordTargetMapCoversTargets` demanded a
`UNIT_TALK_DISCORD_TARGET_MAP` entry for every distribution target. `deploy.yml:612`/`:1411`
refuse that entry for `discord:official-picks`, because a human capper's official pick routes
per capper from the pin the server writes onto the outbox row. The two guards were mutually
unsatisfiable: the deploy refused the mapping when present, and the worker crash-looped when
absent.

The startup assertion was the wrong guard. `delivery-adapters.ts` (WORKER_PINNED_DESTINATION_GUARD)
never consults the map for a human target — it reads the per-capper pin and REFUSES rather than
falling back. The assertion demanded a mapping the delivery path is designed never to read.
Human delivery targets are now exempt via the canonical `isHumanDeliveryTarget` predicate, so a
target cannot be exempt at startup and governed at delivery.

### 2. Command Center could not start from its canonical env file (increment 3)

`packages/config/src/env.ts`, `packages/db/src/client.ts` — the Command Center data client
reaches `loadEnvironment()` and `requireSupabaseEnvironment()`. Between them they demanded six
values the surface never reads, and reported them one per restart.

Five were workspace metadata (`UNIT_TALK_LEGACY_WORKSPACE`, `LINEAR_TEAM_KEY`, `LINEAR_TEAM_NAME`,
`NOTION_WORKSPACE_NAME`, `SLACK_WORKSPACE_NAME`) with **zero** runtime readers anywhere in `apps/`
or `packages/`; only `scripts/` tooling uses them, from the developer workspace, where
`scripts/validate-env.mjs` still requires them and is unchanged. Two callers already fabricated
values to satisfy the check. They are now optional in the runtime loader, and `requireEnv` is
deleted because those five were its only remaining callers.

The sixth was `SUPABASE_ANON_KEY`, demanded even of a caller that opens the connection with the
service-role key and discards the anon key — while `deploy/production/nextjs-entrypoint.sh` says
in its own comment that "the anon key is not a substitute and is not used". The check is now
role-aware.

**`.github/workflows/deploy.yml` is deliberately unchanged.** The ten keys it already writes are
correct and complete. Supplying the six would have institutionalized fake dependencies and
shipped Command Center an unused credential.

## Files outside `file_scope_lock`

`packages/config/src/env.ts`, `packages/config/src/env.test.ts` and `packages/db/src/client.ts`
are not in this lane's `file_scope_lock`, which is pinned at lane-start and cannot be widened on
the branch. They require a PM `scope-override/v1` on PR #1599. No other lane locks either file.
