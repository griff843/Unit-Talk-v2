# API Route Modules Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-141)
**Authority:** Defines the route module split for `apps/api/src/server.ts`.

---

## Problem

`apps/api/src/server.ts` (~566 lines) contains all HTTP route dispatch, rate limiting, body parsing, and CORS logic in a single file. As new routes are added (grading, recap, settlement), this file will grow significantly. Splitting now prevents the same accumulation that already occurred in `operator-web`.

---

## Design

### Target directory structure

```
apps/api/src/
  server.ts                        (wiring layer — createApiServer, createApiRuntimeDependencies, type exports)
  routes/
    health.ts                      (GET /health)
    submissions.ts                 (POST /api/submissions)
    settlements.ts                 (POST /api/picks/:id/settle)
    grading.ts                     (POST /api/picks/:id/grade, internal grading trigger)
```

### Interface contract

Each route module exports a handler function with the signature:

```typescript
export async function handle<RouteName>Request(
  request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void>
```

Where `ApiRouteDependencies` is defined in `server.ts` and contains the repository bundle, rate limit store, and configuration values passed from `createApiServer`.

`routeRequest` in `server.ts` becomes a thin dispatcher:

```typescript
export async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://localhost`);
  const method = request.method ?? 'GET';

  if (method === 'GET' && url.pathname === '/health') return handleHealthRequest(request, response, deps);
  if (method === 'POST' && url.pathname === '/api/submissions') return handleSubmissionsRequest(request, response, deps);
  // ... etc
  writeJson(response, 404, { error: 'not found' });
}
```

Shared utilities (`readJsonBody`, `writeJson`, `setCorsHeaders`, `consumeSubmissionRateLimit`, etc.) move to `apps/api/src/http-utils.ts` and are imported by route modules and `server.ts` as needed.

---

## Behavior Contract

This is a pure refactor. **Zero behavior changes are permitted.**

- All routes respond identically before and after
- All existing tests (`server.test.ts`, `submission-service.test.ts`) pass unchanged
- All type exports from `server.ts` remain exported from `server.ts`
- `createApiServer`, `createApiRuntimeDependencies`, `routeRequest` remain in `server.ts`
- Rate limiting logic stays in the submissions route handler (not shared middleware)
- Body size cap enforcement stays in the submissions route handler
- No new routes added in this PR
- No new env vars

---

## Migration Safety

No DB migrations. No schema changes. No env var changes.

---

## Acceptance Criteria (UTV2-141)

- [ ] `apps/api/src/routes/` directory created with one file per route group
- [ ] `server.ts` reduced to wiring layer: `createApiServer`, `routeRequest` (thin dispatch), type exports
- [ ] Shared HTTP utilities extracted to `apps/api/src/http-utils.ts` (or equivalent)
- [ ] Each route handler in its own module, invoked from `routeRequest`
- [ ] All existing `server.test.ts` tests pass without modification
- [ ] `pnpm verify` passes
- [ ] No new tests required (behavior unchanged)
- [ ] No behavior changes: identical HTTP responses for all routes

---

## Out of Scope

- Adding new routes
- Changing rate limiting behavior
- Changing body parsing behavior
- Changing type definitions
- Test refactoring
