# Runtime Verification — UTV2-923

**PR:** #661  
**Branch:** codex/utv2-923-remove-runtime-ambiguity  
**Head SHA:** ffe0b079  
**Merge SHA:** 32a76705db9993f06d4b0dadf1c149b6d7d5f3df  
**Date:** 2026-05-14  
**Tier:** T2 — no DB migration, no `packages/db` changes, no `*-service.ts` changes

---

## Verification checklist

- `pnpm verify` (env:check + lint + type-check + build + test): PASS
- `pnpm type-check` (TypeScript project references): PASS
- `pnpm lint` (ESLint): PASS
- `pnpm build` (compile all packages and apps): PASS
- `pnpm test` (all unit tests): PASS

### Focused test verification

- `packages/observability/src/index.test.ts` — `buildRuntimeTruthReport` serializes real-work state without leaking secrets: PASS
- `packages/observability/src/index.test.ts` — `runtimeTruthLogFields` emits compact operator-safe startup fields: PASS
- `apps/api/src/server.test.ts` — `GET /api/runtime/truth` returns redacted operator runtime truth (operator auth required, non-operator denied, workerTargets from queue health): PASS
- `apps/api/src/server.test.ts` — `buildApiRuntimeTruth` marks database persistence as real API work: PASS
- `apps/worker/src/worker-runtime.test.ts` — worker runtime truth fields verified: PASS
- `apps/command-center/src/lib/server-api.test.ts` — `fetchRuntimeTruth` verified: PASS

### Runtime behavior verified by tests

- **Secret redaction:** `JSON.stringify(report).includes('super-secret')` is false — confirmed by observability test. Recursive redaction of `apiKey`, `serviceRoleKey` confirmed with path tracking (`credentials.apiKey`, `credentials.serviceRoleKey`).
- **Auth gate:** Unauthenticated requests to `GET /api/runtime/truth` receive 401. Operator-authenticated requests receive 200 with `RuntimeTruthReport`.
- **Startup log:** `withRuntimeTruthStartupLog` logs `runtimeTruthLogFields` at API startup — confirmed by test that creates API runtime dependencies with injected repositories.
- **Worker doingRealWork:** All 6 conditions for `doingRealWork` checked (`persistenceMode === 'database'`, `autorun`, `!dryRun`, `!simulationMode`, `adapterKind === 'discord'`, `targetCoverage.ok`). Reason builder covers all branches.
- **Command Center degradation:** `fetchRuntimeTruth` catch path returns `{ runtimeTruth: null, error }` — panel renders amber error state when API is unreachable.

### Why `pnpm test:db` is not required

No files under `supabase/migrations/**`, `packages/db/**`, or `apps/api/src/**-service.ts` were modified. This is an observability surface addition; no database schema or query path changed.

---

result: pass
