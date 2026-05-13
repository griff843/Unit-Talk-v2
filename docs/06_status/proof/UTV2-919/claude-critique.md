# Claude Critique — UTV2-919

**Issue:** UT-P0-006 Enforce Service-to-Service Authentication  
**Branch:** griffadavi/utv2-919-ut-p0-006-enforce-service-to-service-authentication  
**Merge SHA:** (to be populated after merge)  
**Critic:** Claude Sonnet 4.6 (orchestrator)  
**Date:** 2026-05-13

---

## Invariant Correctness

The diff preserves all invariants the issue was designed to enforce:

- **No auth bypass introduced.** `createApiClient()` only adds the `Authorization` header when `apiKey` is present; absent key → no header (same as pre-change behavior in fail_open). No conditional that silently passes auth when the key is empty.
- **Fail-closed path unchanged.** `loadAuthConfig()` still throws when `failClosed=true` and `keys.size === 0`. The two new env vars are additive entries in `keySources` — they contribute to `keys.size` in production if configured, so they help satisfy the fail-closed constraint rather than weakening it.
- **Role scoping correct.** Ingestor gets `settler` role — it calls `/api/grading/run` which requires `settler|operator`. Bot gets `submitter` role — it calls `/api/submissions` and `/api/member-tiers`. Command-center is `operator` and unchanged. No over-privileged assignments.
- **Identity logging preserved.** Both new key sources follow `${identityPrefix}:${key.slice(0, 8)}` format, so auth failure logs continue to identify which service is failing.
- **No mutation of existing `AuthRole` enum.** No new roles introduced; existing roles reused correctly.

## Regression Risk

- **`triggerGradingRun` signature change** (`apiKey` inserted before `fetchImpl`) breaks any caller that previously passed `fetchImpl` as second arg. The only callers are: (1) `triggerGradingForCycle` (internal, updated), (2) test file (updated). No external callers exist per grep. Risk: low.
- **`createApiClient` signature change** (same pattern). All 11 call sites updated. Test file call sites updated. No un-patched call sites per grep. Risk: low.
- **Header merge in `createApiClient`:** The `merged` RequestInit spreads `authHeader` first, then `init?.headers`. This means per-call headers override the auth header if a caller explicitly passes `Authorization`. This is correct — caller intent should win — but it means a caller could accidentally mask the auth header. Reviewed all call sites: none pass custom `Authorization` headers. Risk: negligible.
- **`AppEnv` additions** in `packages/config/src/env.ts`: purely additive optional fields. No breaking change to any downstream consumer.

## Scope Drift

Diff is contained within the declared `file_scope_lock`. Files touched:
- `packages/config/src/env.ts` — AppEnv + loadEnvironment additions (required for typed env access)
- `apps/api/src/auth.ts` — keySources additions
- `apps/api/src/server.ts` — API_AUTH_KEYS + createAuthConfigEnv additions
- `apps/api/src/auth.test.ts` — 2 new tests
- `apps/ingestor/src/ingestor-runner.ts` — IngestorRunnerOptions + triggerGradingRun signature
- `apps/ingestor/src/index.ts` — ingestorApiKey wiring
- `apps/ingestor/src/ingestor.test.ts` — 2 new tests
- `apps/discord-bot/src/api-client.ts` — createApiClient signature
- `apps/discord-bot/src/config.ts` — BotConfig.apiKey + parseBotConfig/parseQaBotConfig
- `apps/discord-bot/src/commands/*.ts` (10 files) — call site updates
- `apps/discord-bot/src/main.ts` — call site update
- `apps/discord-bot/src/discord-bot-foundation.test.ts` — existing tests updated + 2 new tests
- `.env.example` — 2 new entries with rotation comment
- `docs/06_status/lanes/UTV2-919.json` — lane manifest

No changes to database schema, no changes to pick lifecycle, no changes to governance/protocol logic.

## Hidden Coupling

- `triggerGradingRun` is exported from `ingestor-runner.ts`. No package-level re-export; only consumed within the ingestor app. No hidden coupling.
- `createApiClient` is consumed by all command files and `main.ts`. All call sites updated. The `apiKey` param is optional so the function remains backwards-compatible for test usage.

## Verdict

**APPROVE**

The diff is minimal, correct, and precisely scoped. Auth surface gaps are closed — ingestor grading trigger and discord-bot API calls now carry scoped Bearer tokens in production. Command-center was already correct and untouched. `pnpm verify` passes green (144/0 + 113/0 across all test suites, type-check clean, lint clean). 

Runtime verification is still required before merge: real auth-flow trace must appear in `runtime-verification.md` showing:
1. API logs `settler:ingestor:XXXXXXXX` when ingestor triggers grading with the key
2. API returns 401 and logs reason when key is absent in fail_closed mode
3. API logs `submitter:discord-bot:XXXXXXXX` on a bot mutation with the key
