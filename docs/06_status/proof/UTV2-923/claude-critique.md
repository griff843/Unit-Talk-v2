# Claude Critique — UTV2-923

**PR:** #661  
**Branch:** codex/utv2-923-remove-runtime-ambiguity  
**Head SHA at critique:** ffe0b079  
**Merge SHA:** 32a76705db9993f06d4b0dadf1c149b6d7d5f3df  
**Critic:** Claude Sonnet 4.6 (orchestrator)  
**Date:** 2026-05-14

---

## Invariant correctness

**Invariant 7 (domain is pure — no I/O, no env):** Not touched. The new serializer lives in `packages/observability`, which is already permitted to make HTTP calls (Loki writer). `buildRuntimeTruthReport` itself is pure — it accepts input and returns a value.

**Invariant 8 (apps own side effects; packages never import from apps):** The new `@unit-talk/observability` exports (`buildRuntimeTruthReport`, `runtimeTruthLogFields`) are consumed by apps. No app-to-package or app-to-app import was added.

**Invariant 9 (outbox is the only delivery queue):** Not touched.

**Invariant 10 (fail closed):** The `GET /api/runtime/truth` endpoint is auth-gated to operator role. Unauthenticated requests receive 401. This is a read-only observability surface; no writes are gated by it.

**Invariant 11 (mechanical enforcement):** The P0 protocol gate now mechanically requires this file and `runtime-verification.md` before merge — enforcing what was previously narrative.

---

## Regression risk

**API startup:** `withRuntimeTruthStartupLog` is called in `createApiRuntimeDependencies` before the server is returned. If `buildApiRuntimeTruth` throws, the API will not start. The function is pure and cannot throw (it calls `buildRuntimeTruthReport` which handles all edge cases via `sanitizeRuntimeTruthDetails` and null-safe accessors).

**Worker startup:** `withWorkerRuntimeTruth` wraps both the database and in-memory branches of `createWorkerRuntimeDependencies`. Same analysis — pure, cannot throw.

**Secret leakage:** `sanitizeRuntimeTruthDetails` performs recursive redaction by key name. The `isSensitiveRuntimeTruthKey` function covers: `apikey`, `apikeys`, `token`, `tokens`, `secret`, `secrets`, `password`, `authorization`, `servicerolekey`, `webhookurl`. The test at `packages/observability/src/index.test.ts` asserts that `super-secret-api-key` and `super-secret-service-role` are redacted and that `JSON.stringify(report).includes('super-secret')` is false. None of the actual `details` payloads in this PR pass raw key values — only presence indicators.

**Process.env bypass (fixed):** The original Codex implementation read `process.env['UNIT_TALK_DISTRIBUTION_TARGETS']` directly in `buildApiRuntimeTruth`. This was identified during critique and fixed: `workerTargets` now derives from `runtime.queueHealth?.workerTargets ?? []`. This restores single-source runtime authority and removes implicit ambient state reads.

---

## Scope drift

Declared file scope: API, worker, ingestor, observability, Command Center.

Actual changes:
- `packages/observability/src/index.ts` — `RuntimeTruthInput`, `RuntimeTruthReport`, `buildRuntimeTruthReport`, `runtimeTruthLogFields`, helper functions. Within scope.
- `packages/observability/src/index.test.ts` — tests for new exports. Within scope.
- `apps/api/src/server.ts` — `buildApiRuntimeTruth`, `handleRuntimeTruth`, `withRuntimeTruthStartupLog`. Within scope.
- `apps/api/src/server.test.ts` — tests for new endpoint and builder. Within scope.
- `apps/worker/src/runtime.ts` — `withWorkerRuntimeTruth`, `buildWorkerRealWorkReason`. Within scope.
- `apps/worker/src/worker-runtime.test.ts` — tests for new runtime truth fields. Within scope.
- `apps/ingestor/src/index.ts` — `withIngestorRuntimeTruth`, `buildIngestorRealWorkReason`. Within scope.
- `apps/command-center/src/lib/server-api.ts` — `fetchRuntimeTruth`. Within scope.
- `apps/command-center/src/lib/server-api.test.ts` — tests. Within scope.
- `apps/command-center/src/app/api-health/page.tsx` — `RuntimeTruthPanel` component. Within scope.
- `docs/06_status/proof/UTV2-923/` — proof artifacts. Required by P0 protocol.

No schema changes, no migration files, no lifecycle or settlement changes. Scope clean.

---

## Hidden coupling

- **Command Center → API:** `fetchRuntimeTruth` calls `GET /api/runtime/truth` using `UNIT_TALK_CC_API_KEY`. The endpoint requires operator role. If the CC API key is not operator-scoped, the panel degrades gracefully (amber error state). Coupling is explicit and pre-existing (CC already calls other API endpoints with this key).
- **Worker truth is a startup snapshot:** `WorkerRuntimeDependencies.runtimeTruth` is built once at startup. `lastWorkAt` will always be null. Operators reading this field should understand it reflects startup state, not live state. This is a scope limitation, not a bug — updating it during the delivery cycle was out of scope for UTV2-923.
- **Ingestor `'in-memory'` vs `'in_memory'`:** The ingestor uses hyphenated `'in-memory'` for persistence mode while API/worker use underscore `'in_memory'`. This is pre-existing inconsistency in `RuntimeTruthInput.persistenceMode: string` (generic string field). Not introduced by this PR.

---

## Minor issues noted (non-blocking)

1. `handleRuntimeTruth` returns 401 for authenticated non-operators; should be 403. The POST auth gate correctly uses 403 for role denials. Follow-up issue appropriate.
2. `isSensitiveRuntimeTruthKey` does not catch `anonkey`/`anonKey` pattern. Not currently exposed in any details payload in this PR, but gap exists for future contributors. Follow-up appropriate.

---

## Verdict

**APPROVE**

The implementation is correct, the process.env bypass was caught and fixed during critique, redaction is tested, scope is clean, and no invariants are violated. The two minor issues noted above are suitable for follow-up issues and do not block merge.

---

*Critique authored by Claude Sonnet 4.6 as orchestrator during pre-merge review, 2026-05-14.*
