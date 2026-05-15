# Verification Log — UTV2-931: Replace In-Memory Rate Limiting

## Branch
`codex/utv2-931-replace-in-memory-rate-limiting` — branch SHA `18b9e710d8a97b37fc6b691188aa5c0e4c0c21e5`

## Merge
Squash-merged to main as SHA `3932f609fec041ec9134d0a5c485ecb67a1aa352` (PR #674, merged 2026-05-15T12:00:18Z)

## Verification Steps

### pnpm type-check
```
> pnpm exec tsc -b tsconfig.json
(exit 0 — no errors)
```

### pnpm test
```
ℹ tests 178
ℹ suites 6
ℹ pass 178
ℹ fail 0
ℹ duration_ms 17104.77
```

## Acceptance Criteria

- [x] `UNIT_TALK_API_RATE_LIMIT_STORE` env var wired in `packages/config/src/env.ts`
- [x] `UNIT_TALK_API_RATE_LIMIT_KEY_STRATEGY` env var wired
- [x] `InMemoryApiRateLimitStore` — works for local/test (default)
- [x] `SupabaseRpcApiRateLimitStore` — production path via Postgres RPC
- [x] `assertProductionRateLimitConfig` blocks memory store in production runtime
- [x] No in-scope TypeScript errors
- [x] All tests pass (178/178)
- [x] Codex hallucinated imports (`createTraceLogFields`, `attachTraceContextToMetadata`) resolved
