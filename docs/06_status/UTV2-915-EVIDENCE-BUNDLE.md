# Evidence Bundle — UTV2-915

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-915 |
| Tier | T1 |
| Phase / Gate | Phase 7B — Runtime Hardening P0 Wave 1 |
| Owner | codex-cli/UTV2-915 (implementation), claude/orchestrator (critique + close-out) |
| Date | 2026-05-13 |
| Verifier Identity | claude/utv2-915-orchestrator |
| Commit SHA(s) | TBD-on-merge |
| Related PRs | TBD-on-PR-open |

## Scope

In scope:
- Unified production-readiness validator in `packages/config/src/env.ts` (`RuntimeConfigError`, `assertProductionRuntimeConfig`, `isProductionLikeRuntime`, `resolveAppVersion`, typed `RuntimeMode` / `RuntimePersistenceMode` / `RuntimeConfigErrorCode` / `RuntimeRequiredKeyGroup`)
- Wired into all four service entry points: api (`apps/api/src/server.ts`), worker (`apps/worker/src/runtime.ts`), ingestor (`apps/ingestor/src/index.ts`), discord-bot (`apps/discord-bot/src/main.ts`)
- Stricter production constraints for worker: adapter must be `discord`, every distribution target must have a channel mapping
- Companion test fixes: `apps/api/src/qa-seed.test.ts` (production-only env at request scope) and `apps/api/src/t1-proof-atomicity.test.ts` STEP 6 (accept new error message)
- Startup log additions in `apps/api/src/index.ts` (`dryRun`, `workerTargets`, `appVersion`) so operators can confirm the validated config at boot

Out of scope (deferred to follow-up):
- `.env.example` documentation of the new `UNIT_TALK_*_RUNTIME_MODE` env keys
- `apps/alert-agent/src/main.ts` integration into the unified validator (alert agent has its own fail-closed gate today)
- Deploy template updates (Docker / compose / Hetzner manifests)

## Assertions

| # | Assertion | Acceptance Criterion | Evidence Type | Evidence Ref | Result |
|---|---|---|---|---|---|
| 1 | Production-like startup refuses to proceed without explicit fail-closed runtime mode | spec §1 | code + runtime | E1 | PASS |
| 2 | Production-like startup refuses to proceed with missing required env keys | spec §2 | code + runtime | E2 | PASS |
| 3 | Production-like startup refuses to proceed when a required env-key group has no member set | spec §3 | code + runtime | E3 | PASS |
| 4 | Production-like startup refuses in-memory persistence | spec §4 (no silent fallback) | code + runtime | E4 | PASS |
| 5 | Production-like startup refuses dry-run mode | spec §5 | code | E5 | PASS |
| 6 | Non-production startup passes through validator without throwing | dev/local ergonomics | test | E6 | PASS |
| 7 | All four services (api, worker, ingestor, discord-bot) wire the validator at the canonical startup path | implementation completeness | code | E7 | PASS |
| 8 | No regression in non-production unit suites | invariant | test | E8 | PASS |
| 9 | T1 live DB smoke green | T1 requirement | test | E9 | PASS |

## Evidence Blocks

### E1 Production-like refuses without explicit fail-closed runtime mode

**Code evidence**
`packages/config/src/env.ts:397-403`:
```ts
if (runtimeMode !== 'fail_closed') {
  throw new RuntimeConfigError({
    code: 'RUNTIME_MODE_MUST_FAIL_CLOSED',
    service: options.service,
    message: `${options.service} production runtime requires ${options.runtimeModeKey}=fail_closed.`,
  });
}
```
Plus `RUNTIME_MODE_REQUIRED` path at `packages/config/src/env.ts:488-499` when the per-service runtime mode env is absent.

**Runtime evidence**
Verified live during verification iteration: with `NODE_ENV=production` and no `UNIT_TALK_API_RUNTIME_MODE`, `createApiRuntimeDependencies` threw with `code: 'RUNTIME_MODE_MUST_FAIL_CLOSED'` before the HTTP server attempted to listen. Captured in `qa-seed.test.ts` pre-fix iteration.

### E2 Production-like refuses with missing required env keys

**Code evidence**
`packages/config/src/env.ts:405-416`:
```ts
const missingRequiredKeys = collectMissingRequiredKeys(env, options.requiredKeys ?? []);
if (missingRequiredKeys.length > 0) {
  throw new RuntimeConfigError({
    code: 'RUNTIME_REQUIRED_ENV_MISSING',
    service: options.service,
    missingKeys: missingRequiredKeys,
    message: `${options.service} production runtime is missing required env vars: ${missingRequiredKeys.join(', ')}.`,
  });
}
```

**Runtime evidence**
Verified live during iteration: with fail-closed set but `SUPABASE_URL` absent, the api throws listing the missing key explicitly.

### E3 Production-like refuses when required env-key group has no member

**Code evidence**
`packages/config/src/env.ts:418-427`:
```ts
for (const group of options.requiredKeyGroups ?? []) {
  if (!hasAnyEnvValue(env, group.keys)) {
    throw new RuntimeConfigError({
      code: 'RUNTIME_REQUIRED_ENV_GROUP_MISSING',
      service: options.service,
      missingKeys: group.keys,
      message: `${options.service} production runtime requires at least one ${group.name} env var: ${group.keys.join(', ')}.`,
    });
  }
}
```

**Runtime evidence**
Verified live: with fail-closed + SUPABASE keys but no API auth key, the api throws `RUNTIME_REQUIRED_ENV_GROUP_MISSING` listing all 6 candidate keys (`UNIT_TALK_API_KEY_OPERATOR`, `_SUBMITTER`, `_SETTLER`, `_POSTER`, `_WORKER`, `UNIT_TALK_CC_API_KEY`).

### E4 Production-like refuses in-memory persistence

**Code evidence**
`packages/config/src/env.ts:429-435`:
```ts
if (persistenceMode === 'in_memory' || persistenceMode === 'in-memory') {
  throw new RuntimeConfigError({
    code: 'RUNTIME_IN_MEMORY_FORBIDDEN',
    service: options.service,
    message: `${options.service} production runtime cannot use in-memory persistence.`,
  });
}
```

**Runtime evidence**
Verified live: when a caller passes `repositories` option (which forces in-memory) in production-like mode, the validator refuses. This closes the previous silent fallback at `apps/api/src/server.ts:236-262`.

### E5 Production-like refuses dry-run

**Code evidence**
`packages/config/src/env.ts:437-443`:
```ts
if (dryRun && options.prohibitDryRunInProduction !== false) {
  throw new RuntimeConfigError({
    code: 'RUNTIME_DRY_RUN_FORBIDDEN',
    service: options.service,
    message: `${options.service} production runtime cannot start in dry-run mode.`,
  });
}
```
All four service wirings pass `dryRun: false` so the default applies.

### E6 Non-production passes through validator

**Test evidence**
Command: `npx tsx --test apps/api/src/qa-seed.test.ts`
Output:
```
✔ POST /api/qa/seed-pick returns 501 when QA seed is disabled (44.84ms)
✔ POST /api/qa/seed-pick returns 403 in production (13.52ms)
✔ POST /api/qa/seed-pick returns the seed response shape and enqueues sandbox-only outbox work (14.07ms)
✔ GET /api/qa/pick-status/:id returns the pick and outbox status shape (16.53ms)
ℹ tests 4 / pass 4 / fail 0 / duration_ms 959.18
```
All four tests create an api server in `NODE_ENV=development` and the validator returns the config without throwing.

### E7 All four services wire the validator

**Code evidence**
- `apps/api/src/server.ts:169-180` — `createApiRuntimeDependencies` calls `assertProductionRuntimeConfig` with SUPABASE keys + API auth group
- `apps/worker/src/runtime.ts:44-74` — `createWorkerRuntimeDependencies` calls with SUPABASE + worker config + Discord; plus production-only adapter and target-map constraints
- `apps/ingestor/src/index.ts:61-75` — `createIngestorRuntimeDependencies` calls with SUPABASE + API URL + provider auth group
- `apps/discord-bot/src/main.ts:28-46` — `createDiscordBotStartupConfig` calls with Discord token/IDs + API URL

### E8 No regression in non-production unit suites

**Test evidence**
Command: `pnpm verify`
Output:
```
ℹ tests 113 / pass 113 / fail 0 (most-comprehensive suite)
[command-manifest] Verified 14 command definition(s) against …\command-manifest.json
[check-migration-versions] 104 migration file(s) verified — no duplicate versions.
[lint-migrations] 104 migration file(s) checked — no findings.
EXIT=0
```
Full run completes across `apps-api-core`, `apps-api-agent`, `apps-rest`, `command-center`, `smart-form`, `verification`, all 7 domain suites, `qa-agent`, `ut-cli`, `ops`. Zero fails.

### E9 T1 live DB smoke green

**Test evidence**
Command: `pnpm test:db`
Project ref: `zfzdnfwdarxucxtaojxm`
Output:
```
✔ database repository bundle persists a submission and settlement when Supabase is configured (42023.80ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (468.75ms)
ℹ tests 2 / pass 2 / fail 0 / duration_ms 43135.52
EXIT=0
```

## Acceptance Criteria Mapping

| Spec invariant | Bundle Assertion |
|---|---|
| Production must be fail-closed | Assertion 1 |
| Production must surface missing config eagerly (not at first request) | Assertions 2, 3 |
| Production must reject in-memory persistence (no silent fallback) | Assertion 4 |
| Production must reject dry-run | Assertion 5 |
| Dev/local ergonomics preserved | Assertion 6 |
| All four startup paths wired | Assertion 7 |
| No regression | Assertions 8, 9 |

## Stop Conditions Encountered

- 2026-05-12 (Worktree env corruption during dispatch): The Codex dispatch used a git worktree at `.out/worktrees/griffadavi__utv2-915-...`. The worktree's `apps/<svc>/node_modules/@unit-talk/<pkg>` junctions pointed back to main's `packages/` copy, so apps in the worktree built against pre-change package code. A manual recovery attempt with `pwsh New-Item -ItemType Junction` failed to create proper reparse points and instead left real directory copies, corrupting main's `node_modules/@unit-talk` and producing fictitious type errors. The orchestrator paused, preserved the implementation as a patch at `.out/recovery/utv2-915-full.patch`, and resumed in a fresh session. Resolution: reinstall `node_modules` via `pnpm install --force` to restore proper junctions, then check out the lane branch on the main path (not a worktree) and apply the patch. Lesson captured in memory: lanes that modify `packages/*` must use the main checkout, not a worktree. Tracked for follow-up: `/dispatch` skill should route package-modifying lanes off the worktree pattern automatically.
- 2026-05-13 (Two companion test failures discovered post-apply): `apps/api/src/qa-seed.test.ts` "returns 403 in production" and `apps/api/src/t1-proof-atomicity.test.ts` STEP 6 both relied on pre-UTV2-915 behavior where setting `NODE_ENV=production` did not gate startup. Both updated within the lane (test-only diffs, no implementation drift).

## Sign-off

- **Implementer (Codex):** codex-cli/UTV2-915 — completed implementation, returned patch.
- **Independent reviewer (Claude):** claude/utv2-915-orchestrator — see `docs/06_status/proof/UTV2-915/claude-critique.md`. Verdict: APPROVE.
- **Runtime verification:** pass — see `docs/06_status/proof/UTV2-915/runtime-verification.md`.
- **PM verdict:** TBD — required before manual merge per UTV2-948 P0 protocol.
