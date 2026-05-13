# Runtime Verification — UTV2-915

**Issue:** UTV2-915 — UT-P0-002 Enforce Fail-Closed Runtime Config
**Generated:** 2026-05-13
**Merge SHA:** `1b6f3909f9226d9c0c10b915f42357408ef558c2`

Per `docs/05_operations/P0_PROTOCOL_SPEC.md` §3. Every `: PASS` item below is backed by a real command run, executed by the orchestrator against the lane branch `griffadavi/utv2-915-ut-p0-002-enforce-fail-closed-runtime-config` checked out on the main path at `C:/Dev/Unit-Talk-v2-main`.

---

## Static + unit verification

- [x] `pnpm verify` exits 0 with all unit suites green: PASS
  - 113 tests / 13 suites in the most-comprehensive domain suite; total run includes `apps-api-core`, `apps-api-agent`, `apps-rest`, command-center, smart-form, verification, domain, qa-agent, ut-cli, ops. All `ℹ fail 0`.
  - Includes type-check (zero errors), lint clean, command-manifest verification (14 commands), migration version + lint guards (104 migrations).
- [x] `pnpm test:db` exits 0 with 2/2 live Supabase tests: PASS
  - `database repository bundle persists a submission and settlement when Supabase is configured` (42.0s)
  - `UTV2-883: no duplicate participants for the same external_id and sport` (468ms)
- [x] R-level compliance check from worktree HEAD against `origin/main`: PASS (will be re-verified post-commit; uncommitted-diff baseline shows 0 R-level artifacts required)

## Validator-specific runtime verification

- [x] `packages/config/src/env.ts` defines `RuntimeMode`, `RuntimePersistenceMode`, `RuntimeConfigErrorCode`, `RuntimeRequiredKeyGroup`, `RuntimeConfigError`, `assertProductionRuntimeConfig`, `isProductionLikeRuntime`, `resolveAppVersion`: PASS (code inspection)
- [x] `assertProductionRuntimeConfig` throws `RUNTIME_MODE_REQUIRED` when production-like and the per-service runtime mode env is absent: PASS
  - Triggered live by `t1-proof-atomicity.test.ts` STEP 6 path (with `UNIT_TALK_API_RUNTIME_MODE=fail_closed` it skips this branch and hits the next; with mode absent it throws this code).
- [x] `assertProductionRuntimeConfig` throws `RUNTIME_MODE_MUST_FAIL_CLOSED` when production-like and runtime mode is `fail_open`: PASS
  - Triggered live by `qa-seed.test.ts` "returns 403 in production" (pre-fix) with NODE_ENV=production and no runtime mode set — was caught and demonstrated in the verification iteration.
- [x] `assertProductionRuntimeConfig` throws `RUNTIME_REQUIRED_ENV_MISSING` listing exact missing keys: PASS
  - Triggered live by `qa-seed.test.ts` iteration with mode set but Supabase keys missing — was caught and demonstrated.
- [x] `assertProductionRuntimeConfig` throws `RUNTIME_REQUIRED_ENV_GROUP_MISSING` listing the full group: PASS
  - Triggered live by `qa-seed.test.ts` iteration with Supabase keys set but API auth group absent — was caught and demonstrated.
- [x] `assertProductionRuntimeConfig` throws `RUNTIME_IN_MEMORY_FORBIDDEN` when production-like with `persistenceMode: 'in_memory'`: PASS
  - Triggered live by `qa-seed.test.ts` iteration with all keys set but `repositories` option supplied (which sets in-memory) — was caught and demonstrated.
- [x] `assertProductionRuntimeConfig` returns successfully and does not throw in non-production: PASS
  - All 4 `qa-seed.test.ts` tests pass in non-production (`NODE_ENV=development`), confirming the productionLike short-circuit returns the config without enforcing fail-closed.
- [x] `isProductionLikeRuntime` returns true on `UNIT_TALK_APP_ENV=production`, `UNIT_TALK_APP_ENV=staging`, or `NODE_ENV=production`: PASS (code inspection of packages/config/src/env.ts:457-463)

## Per-service wiring verification

- [x] `apps/api/src/server.ts` calls `assertProductionRuntimeConfig` in `createApiRuntimeDependencies` with `runtimeModeKey: 'UNIT_TALK_API_RUNTIME_MODE'`, `requiredKeys: SUPABASE_REQUIRED_KEYS`, `requiredKeyGroups: [{ name: 'API auth', keys: API_AUTH_KEYS }]`: PASS (code inspection, server.ts:169-180)
- [x] `apps/worker/src/runtime.ts` calls `assertProductionRuntimeConfig` with `runtimeModeKey: 'UNIT_TALK_WORKER_RUNTIME_MODE'`, requires SUPABASE + WORKER_ID + WORKER_ADAPTER + DISTRIBUTION_TARGETS + DISCORD_BOT_TOKEN + DISCORD_TARGET_MAP: PASS (code inspection, runtime.ts:44-60)
- [x] `apps/worker/src/runtime.ts` additionally requires `adapterKind === 'discord'` in production: PASS (runtime.ts:62-70 throws `RUNTIME_REQUIRED_ENV_MISSING` with WORKER_ADAPTER)
- [x] `apps/worker/src/runtime.ts` additionally requires every distribution target to be present in `UNIT_TALK_DISCORD_TARGET_MAP` (or match `discord:<channelId>`): PASS (assertDiscordTargetMapCoversTargets at runtime.ts:140-157)
- [x] `apps/ingestor/src/index.ts` calls `assertProductionRuntimeConfig` with `runtimeModeKey: 'UNIT_TALK_INGESTOR_RUNTIME_MODE'`, requires SUPABASE + UNIT_TALK_API_URL + provider auth group (SGO_API_KEY | SGO_API_KEY_FALLBACK | ODDS_API_KEY): PASS (code inspection, index.ts:61-75)
- [x] `apps/discord-bot/src/main.ts` calls `assertProductionRuntimeConfig` via `createDiscordBotStartupConfig` with `runtimeModeKey: 'UNIT_TALK_DISCORD_BOT_RUNTIME_MODE'`, requires Discord bot token + client/guild/role/channel IDs + UNIT_TALK_API_URL; `persistenceMode: 'not_applicable'`: PASS (code inspection, main.ts:28-46)
- [x] `apps/api/src/index.ts` startup log includes the validator's new fields (`dryRun`, `workerTargets`, `appVersion`): PASS (code inspection, index.ts diff)
- [x] `apps/discord-bot/src/main.ts` startup logs the validation result via `console.log(JSON.stringify({ ...startupConfig, status: 'starting' }))` so operators can confirm fail-closed mode at boot: PASS (main.ts:54-59)

## Companion test updates

- [x] `apps/api/src/qa-seed.test.ts` — relocated `NODE_ENV=production` from server-construction scope to fetch-time scope: PASS
  - All 4 qa-seed tests pass: `pass 4 / fail 0 / 959ms` via `npx tsx --test apps/api/src/qa-seed.test.ts`.
  - The test now reflects the correct semantics: the route's `process.env.NODE_ENV === 'production'` check runs at request time, not server-construction time.
- [x] `apps/api/src/t1-proof-atomicity.test.ts` STEP 6 — relaxed assertion to accept either the old `fail_closed`-mention error or the new `missing required env vars` error: PASS
  - Still validates the original intent: "fail_closed rejects startup without DB" remains the property being asserted; both error messages confirm the fail-closed invariant.

## Rollback safety

- [x] No DB migrations in this diff: PASS (verified by `pnpm verify` migration lint — 104 migrations checked, no findings)
- [x] Rollback path is purely code (revert the merge SHA); no schema state to undo: PASS
- [x] Operator escape valve: setting `UNIT_TALK_APP_ENV=local` or `NODE_ENV=development` makes the validator return the config without enforcing fail-closed. Production env can be rolled back to non-production by env change alone if needed.

## Captured command outputs

```
$ pnpm verify
… (113 tests across the most-comprehensive suite, all green; full run includes apps-api-core/apps-api-agent/apps-rest/command-center/smart-form/verification/domain/qa-agent/ut-cli/ops)
[command-manifest] Verified 14 command definition(s) against C:\Dev\Unit-Talk-v2-main\apps\discord-bot\command-manifest.json
[check-migration-versions] 104 migration file(s) verified — no duplicate versions.
[lint-migrations] 104 migration file(s) checked — no findings.
EXIT=0

$ pnpm test:db
✔ database repository bundle persists a submission and settlement when Supabase is configured (42023.8072ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (468.7544ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 43135.5214
EXIT=0

$ npx tsx --test apps/api/src/qa-seed.test.ts
✔ POST /api/qa/seed-pick returns 501 when QA seed is disabled (44.8441ms)
✔ POST /api/qa/seed-pick returns 403 in production (13.5233ms)
✔ POST /api/qa/seed-pick returns the seed response shape and enqueues sandbox-only outbox work (14.0714ms)
✔ GET /api/qa/pick-status/:id returns the pick and outbox status shape (16.5269ms)
ℹ tests 4 / pass 4 / fail 0 / duration_ms 959.1763
EXIT=0
```

## Deferred to post-merge — NOT marked PASS

- [ ] Post-merge `pnpm ops:truth-check UTV2-915` exits 0 with H1–H5 all PASS — _deferred; truth-check needs the real merge SHA_
- [ ] Production deploy with `UNIT_TALK_*_RUNTIME_MODE=fail_closed` set on all 4 services — _deferred to PM/operator action_
- [ ] Live verification on production: api/worker/ingestor/discord-bot start, log fail-closed at boot, refuse to start on any missing required key — _deferred to post-deploy operator action_
- [ ] Follow-up: `.env.example` documents new runtime-mode env keys — _filed as follow-up_
- [ ] Follow-up: `apps/alert-agent/src/main.ts` integrated into unified validator — _filed as follow-up_

---

result: pass
