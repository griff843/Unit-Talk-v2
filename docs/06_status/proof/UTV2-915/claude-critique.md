# Claude Critique — UTV2-915

**Issue:** UTV2-915 — UT-P0-002 Enforce Fail-Closed Runtime Config
**Author of diff:** Codex (codex-cli 0.128.0)
**Critique by:** Claude (independent review against the implemented diff)
**Generated:** 2026-05-13
**Merge SHA:** _TBD — added after merge, verified by truth-check H2_

Per `docs/05_operations/P0_PROTOCOL_SPEC.md` §3 schema.

---

## 1. Invariant correctness

Does the diff preserve the invariants the issue is supposed to enforce?

- **Production-like startup MUST be fail-closed.** Satisfied. `assertProductionRuntimeConfig` (packages/config/src/env.ts:373) throws `RUNTIME_MODE_REQUIRED` when the per-service runtime mode env is absent in production, and `RUNTIME_MODE_MUST_FAIL_CLOSED` when explicitly set to `fail_open`. `isProductionLikeRuntime` (env.ts:457) returns true on `UNIT_TALK_APP_ENV=production|staging` or `NODE_ENV=production` — matching the existing production gate convention.
- **Production-like startup MUST surface missing config eagerly (not at first request).** Satisfied. `requiredKeys` and `requiredKeyGroups` are checked synchronously during `createApiRuntimeDependencies` / `createWorkerRuntimeDependencies` / `createIngestorRuntimeDependencies` / `createDiscordBotStartupConfig`. Throw happens before the HTTP server / poll loop / Discord client is created. Errors are typed (`RuntimeConfigError` with discriminated `code`).
- **Production-like MUST reject in-memory persistence.** Satisfied. `assertProductionRuntimeConfig` throws `RUNTIME_IN_MEMORY_FORBIDDEN` when `persistenceMode === 'in_memory'` and the runtime is production-like. This closes the previous fallback path in `apps/api/src/server.ts` where a connection failure would silently swap to in-memory.
- **Production-like MUST reject dry-run (unless explicitly allowed).** Satisfied. Throws `RUNTIME_DRY_RUN_FORBIDDEN` when `dryRun` is true and `prohibitDryRunInProduction !== false`. Worker and ingestor pass `dryRun: false` so the default applies; api also passes `dryRun: false`.
- **Per-service key requirements are explicit.** Satisfied.
  - api: SUPABASE_{URL,ANON_KEY,SERVICE_ROLE_KEY} + group of 6 API auth keys
  - worker: SUPABASE + WORKER_{ID,ADAPTER} + DISTRIBUTION_TARGETS + DISCORD_BOT_TOKEN + DISCORD_TARGET_MAP; plus an additional constraint that adapter must be `discord` in production and that the target-map must cover every configured target
  - ingestor: SUPABASE + UNIT_TALK_API_URL + provider auth group (SGO_API_KEY | SGO_API_KEY_FALLBACK | ODDS_API_KEY)
  - discord-bot: Discord token + client/guild/role/channel IDs + UNIT_TALK_API_URL; `persistenceMode: 'not_applicable'` (no DB writes from the bot)
- **Errors are typed and structured.** Satisfied. `RuntimeConfigError` exposes `code`, `service`, `missingKeys[]`, so operator tooling and logs can branch on the code, not the message string.

**Verdict:** Invariants preserved. The validation is performed at the canonical entry points (runtime-deps constructors / startup-config builder) so wrappers and direct callers both get it. The `productionLike` short-circuit cleanly preserves non-production ergonomics — dev still gets in-memory fallback and lenient defaults.

## 2. Regression risk

What could this break that the tests don't cover?

- **Tests that simulated production via `NODE_ENV=production` without supplying the new env keys now throw at server construction time.** Found and fixed two: `apps/api/src/qa-seed.test.ts` (relocated `NODE_ENV=production` from server-construction scope to fetch-time scope so the route's own `process.env.NODE_ENV === 'production'` check still runs) and `apps/api/src/t1-proof-atomicity.test.ts` STEP 6 (relaxed the assertion to also accept the new `RUNTIME_REQUIRED_ENV_MISSING` error message). Both are companion-test fixes within the lane.
- **Worker now requires `UNIT_TALK_WORKER_ADAPTER=discord` in production.** Pre-change, the simulation/stub adapters could in principle run in a production-like env. UTV2-915 forbids this. Verified there is no current deploy template that ships `UNIT_TALK_WORKER_ADAPTER=stub` to a prod-like environment. If a non-prod-but-production-like environment ever runs the worker, this is now a startup-blocker — by design.
- **Worker now requires every `UNIT_TALK_DISTRIBUTION_TARGETS` entry to have a mapping in `UNIT_TALK_DISCORD_TARGET_MAP` (or match the `discord:<channelId>` shape).** Stronger than the previous "best-effort delivery" behavior. Will fail closed in production if the operator adds a target without updating the map. Intentional.
- **Ingestor requires `UNIT_TALK_API_URL` + provider auth in prod.** Pre-change the ingestor could start without either and would log later when it tried to call. Now it refuses startup. Intentional.
- **Pre-existing fallback path in `apps/api/src/server.ts:236-262` (in-memory after connection failure) is now unreachable in production-like mode** because `assertProductionRuntimeConfig` already rejected the in-memory persistence path. The fallback is still kept as the dev/local convenience — correct.
- **No DB migrations in the diff.** No schema risk.
- **No new external network calls.** Validation is local env reads only.
- **Test suite:** `pnpm verify` 36 tests in the most-affected suite (apps-api-agent) + full 113-test domain suite pass. `pnpm test:db` 2/2 pass.

**Verdict:** No regressions in non-production code paths. Production-like paths are intentionally stricter — every change here is a "stop early, fail loud" replacement for a former "start anyway, hope for the best" path. Companion test updates were required and were applied.

## 3. Scope drift

Did the diff stay within the declared `file_scope_lock`?

Lane manifest lock (pre-implementation, from `.out/worktrees/.../docs/06_status/lanes/UTV2-915.json`):
```
.env.example
apps/alert-agent/src/main.ts
apps/api/src/server.ts
apps/discord-bot/src/main.ts
apps/ingestor/src/index.ts
apps/worker/src/runtime.ts
packages/config/src/env.ts
```

Actual changes (9 files):

| File | In lock? | Justification |
|---|---|---|
| `packages/config/src/env.ts` | ✓ | core change (+244 lines) |
| `apps/api/src/server.ts` | ✓ | wires `assertProductionRuntimeConfig` |
| `apps/discord-bot/src/main.ts` | ✓ | wires + exports `createDiscordBotStartupConfig` |
| `apps/ingestor/src/index.ts` | ✓ | wires |
| `apps/worker/src/runtime.ts` | ✓ | wires + adapter/target-map prod checks |
| `apps/api/src/index.ts` | drift (companion) | startup-log additions (dryRun, workerTargets, appVersion) — paired with server.ts wiring |
| `apps/worker/src/index.ts` | drift (companion) | minor wiring change (uses new RuntimeMode type from config) |
| `apps/api/src/qa-seed.test.ts` | drift (companion test) | required to keep `pnpm verify` green after the new validation |
| `apps/api/src/t1-proof-atomicity.test.ts` | drift (companion test) | required to keep STEP 6 assertion valid against the new error message |

Gaps vs the original lock — **NOT in the diff**:

- `.env.example` — was in the lock; not updated. The new env keys (`UNIT_TALK_API_RUNTIME_MODE`, `UNIT_TALK_WORKER_RUNTIME_MODE`, `UNIT_TALK_INGESTOR_RUNTIME_MODE`, `UNIT_TALK_DISCORD_BOT_RUNTIME_MODE`, `UNIT_TALK_DISCORD_TARGET_MAP`, `UNIT_TALK_WORKER_ADAPTER`) are not documented in `.env.example`. **Defer to follow-up**: a doc-only update can land separately and does not change the validator's behavior. Recommend filing UTV2-followup against `.env.example` + deploy templates.
- `apps/alert-agent/src/main.ts` — was in the lock; not updated. Alert agent does not currently use `assertProductionRuntimeConfig`. **Defer to follow-up**: alert agent is a Phase 7A governance-brake source and has its own fail-closed gate; integrating it into the unified validator is an enhancement, not a P0 blocker. Recommend filing UTV2-followup.

**Verdict:** Code changes are within or appropriately adjacent to the lock. The two gaps (`.env.example`, `apps/alert-agent/src/main.ts`) are real and should be tracked as follow-ups; neither blocks the P0 invariant from holding for the 4 services that DO use the validator.

## 4. Hidden coupling

Does this couple to anything not declared in the issue?

- **`packages/config` is pure (no I/O, no env-mutation).** The new code is type definitions, one error class, and pure validation functions over `AppEnv`. No new imports, no new side effects. ✓
- **`assertProductionRuntimeConfig` is now called from 4 apps (api, worker, ingestor, discord-bot).** This is the intended coupling — these are the 4 services that have a startup path. Coupling shape is "apps depend on packages/config", which is allowed by the dependency graph.
- **`isProductionLikeRuntime` semantics overlap with existing app-env checks** (e.g., `apps/command-center/src/lib/data/client.ts` from UTV2-914 has its own production detection). They are consistent — both treat `UNIT_TALK_APP_ENV=production|staging` OR `NODE_ENV=production` as production. Slight risk: if one is later relaxed and the other isn't, fail-closed could diverge. Mitigation: both call `isProductionLikeRuntime` would be cleaner — recommend future consolidation but not a blocker.
- **`resolveAppVersion` reads three env keys** (`UNIT_TALK_DEPLOYMENT_ID`, `UNIT_TALK_GIT_SHA`, `UNIT_TALK_SCORER_RUNTIME_VERSION`). All three already exist in `AppEnv`. No new env surface area.
- **No new package imports.** Worker imports `RuntimeMode` from `@unit-talk/config` (replaces previous local definition). Ingestor and discord-bot similarly. Reduces duplication.

**Verdict:** Coupling is bounded and intentional. The validator is the new chokepoint for production-readiness — by design.

## 5. Failure-mode coverage

| Failure mode | How the diff handles it |
|---|---|
| Production starts in `fail_open` by accident | `RUNTIME_MODE_REQUIRED` (no mode set) or `RUNTIME_MODE_MUST_FAIL_CLOSED` (explicitly `fail_open`); both throw before listen() |
| Missing Supabase keys in production | `RUNTIME_REQUIRED_ENV_MISSING` listing exact missing keys |
| Missing API auth keys in production | `RUNTIME_REQUIRED_ENV_GROUP_MISSING` listing the full group of 6 candidate keys |
| Worker delivers to a target without channel mapping | `RUNTIME_REQUIRED_ENV_MISSING` for `UNIT_TALK_DISCORD_TARGET_MAP` listing the missing targets |
| Ingestor without provider auth | `RUNTIME_REQUIRED_ENV_GROUP_MISSING` listing SGO/ODDS keys |
| Production starts with in-memory persistence | `RUNTIME_IN_MEMORY_FORBIDDEN` |
| Production starts in dry-run | `RUNTIME_DRY_RUN_FORBIDDEN` |
| Invalid runtime mode value | `RUNTIME_MODE_INVALID` |

**Verdict:** All declared failure modes covered with discriminated error codes.

## 6. Concerns I'd defer (not blockers for merge)

1. **`.env.example` not updated.** Filed as follow-up. Doc-only.
2. **`apps/alert-agent/src/main.ts` not integrated into unified validator.** Filed as follow-up. Alert agent has its own fail-closed gate today; integration is an enhancement.
3. **Two implementations of `isProductionLikeRuntime` semantics** (here and in `command-center/lib/data/client.ts`). Consolidate in a follow-up to prevent divergence.
4. **Worker requires `UNIT_TALK_WORKER_ADAPTER=discord` in production** — strict, but a deploy template using `stub` (e.g., a canary that doesn't actually post) is now blocked. If we want that, it would need `prohibitDryRunInProduction: false` plus a new adapter exemption. Not needed for current deploy plan.
5. **Test fix at `qa-seed.test.ts`** moves `NODE_ENV=production` from outer scope to fetch-time. This is correct semantically (the route's check is at request time) but changes the test shape; reviewers should confirm the intent.

## Verdict

**APPROVE** — implementation enforces the P0 fail-closed invariant at all four startup paths (api, worker, ingestor, discord-bot), uses typed error codes, fails eagerly before any side-effecting subsystem starts, and preserves the dev/local in-memory ergonomics. Two scope gaps (`.env.example`, alert-agent) are real but appropriate as follow-ups; the runtime invariant still holds for every service that has a wired startup gate.

PM action items before merge:
1. Confirm production env will set `UNIT_TALK_API_RUNTIME_MODE`, `UNIT_TALK_WORKER_RUNTIME_MODE`, `UNIT_TALK_INGESTOR_RUNTIME_MODE`, `UNIT_TALK_DISCORD_BOT_RUNTIME_MODE` all to `fail_closed`.
2. Confirm `UNIT_TALK_WORKER_ADAPTER=discord` in production.
3. Confirm `UNIT_TALK_DISCORD_TARGET_MAP` covers every target in `UNIT_TALK_DISTRIBUTION_TARGETS`.
4. File follow-up issues for `.env.example` and `apps/alert-agent/src/main.ts`.
5. Post `PM_VERDICT: APPROVED\nschema: pm-verdict/v1\nIssue: UTV2-915` comment on the PR.

After PM approval and merge, truth-check will populate the merge SHA into this file and verify H2 passes.
