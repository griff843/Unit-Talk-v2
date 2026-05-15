# Diff Summary — UTV2-931: Replace In-Memory Rate Limiting

## Issue
Rate limiting on `/api/submissions` was in-memory and per-process. Under horizontal scaling, each instance had its own independent counter, allowing combined request rates well above the intended limit.

## Changes

### `packages/config/src/env.ts`
- Added `UNIT_TALK_API_RATE_LIMIT_STORE?: string` — selects `memory` or `supabase_rpc`
- Added `UNIT_TALK_API_RATE_LIMIT_KEY_STRATEGY?: string` — selects key strategy: `authenticated_identity`, `submitted_identity`, or `ip`

### `apps/api/src/server.ts`
- Exported `ApiSubmissionRateLimit`, `ApiRateLimitStoreKind`, `ApiRateLimitKeyStrategy`, `ApiRateLimitResult`, `ApiRateLimitStore` interfaces
- Added `InMemoryApiRateLimitStore` (local dev / test default)
- Added `SupabaseRpcApiRateLimitStore` (production — uses Postgres RPC for distributed counting)
- Added `assertProductionRateLimitConfig` guard — rejects `memory` store in production-like runtimes
- Added `readSubmissionRateLimit`, `readRateLimitStore`, `readRateLimitKeyStrategy` readers from env

### `apps/api/src/routes/submissions.ts`
- Submissions route now consumes the rate limit store from `ApiRuntimeDependencies`
- Rate limit check runs before auth for fail-fast behavior

### `apps/api/src/controllers/submit-pick-controller.ts`
- Fixed hallucinated `createTraceLogFields` import — inlined log fields directly

### `apps/api/src/handlers/submit-pick.ts`
- Fixed hallucinated `attachTraceContextToMetadata` import — inlined metadata enrichment

## Result
- Configurable store: `UNIT_TALK_API_RATE_LIMIT_STORE=memory` (default) or `supabase_rpc` (production)
- Configurable key strategy: `UNIT_TALK_API_RATE_LIMIT_KEY_STRATEGY=submitted_identity` (default)
- Production assertion prevents accidental in-memory store in `fail_closed` runtime
- 178/178 tests pass; `pnpm type-check` green

## Merge
Squash-merged to main as SHA `3932f609fec041ec9134d0a5c485ecb67a1aa352` (PR #674, merged 2026-05-15T12:00:18Z)
