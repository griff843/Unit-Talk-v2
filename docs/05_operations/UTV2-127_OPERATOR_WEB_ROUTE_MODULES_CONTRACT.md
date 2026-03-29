# Operator-Web Route Modules Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-127)
**Authority:** Defines the route module split for `apps/operator-web/src/server.ts`.

---

## Problem

`apps/operator-web/src/server.ts` is ~2600 lines. All HTTP routes, snapshot logic, HTML rendering, and provider wiring live in a single file. This makes the file hard to navigate, slows down type-checking, and increases merge conflict risk as new routes are added.

---

## Design

### Target directory structure

```
apps/operator-web/src/
  server.ts                        (wiring layer — createOperatorServer, createOperatorSnapshotProvider, type exports)
  routes/
    health.ts                      (GET /health)
    snapshot.ts                    (GET /api/operator/snapshot)
    picks-pipeline.ts              (GET /api/operator/picks-pipeline)
    recap.ts                       (GET /api/operator/recap)
    stats.ts                       (GET /api/operator/stats)
    leaderboard.ts                 (GET /api/operator/leaderboard)
    capper-recap.ts                (GET /api/operator/capper-recap)
    participants.ts                (GET /api/operator/participants)
    dashboard.ts                   (GET / — HTML render)
```

### Interface contract

Each route module exports a single handler function with the signature:

```typescript
export async function handle<RouteName>Request(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void>
```

Where `OperatorRouteDependencies` is defined in `server.ts` and contains the snapshot provider, stats provider, and any other shared dependencies passed from `createOperatorServer`.

`routeOperatorRequest` in `server.ts` becomes a thin dispatcher:

```typescript
export async function routeOperatorRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://localhost`);
  const method = request.method ?? 'GET';

  if (method === 'GET' && url.pathname === '/health') return handleHealthRequest(request, response, deps);
  if (method === 'GET' && url.pathname === '/api/operator/snapshot') return handleSnapshotRequest(request, response, deps);
  // ... etc
  writeJson(response, 404, { error: 'not found' });
}
```

---

## Behavior Contract

This is a pure refactor. **Zero behavior changes are permitted.**

- All routes respond identically before and after
- All existing tests (`server.test.ts`) pass unchanged without modification
- All type exports from `server.ts` remain exported from `server.ts` (not re-exported from route modules)
- `createOperatorServer`, `createOperatorSnapshotProvider`, `createSnapshotFromRows` remain in `server.ts`
- No new HTTP routes added in this PR
- No snapshot query changes
- No HTML changes

---

## Migration Safety

No DB migrations. No schema changes. No env var changes.

---

## Acceptance Criteria (UTV2-127)

- [ ] `apps/operator-web/src/routes/` directory created with one file per route group
- [ ] `server.ts` reduced to wiring layer: `createOperatorServer`, `routeOperatorRequest` (thin dispatch), `createOperatorSnapshotProvider`, type exports
- [ ] Each route handler in its own module, invoked from `routeOperatorRequest`
- [ ] All existing `server.test.ts` tests pass without modification
- [ ] `pnpm verify` passes
- [ ] No new tests required (behavior unchanged — existing tests provide coverage)
- [ ] No behavior changes: identical HTTP responses for all routes

---

## Out of Scope

- Adding new routes
- Changing snapshot query logic
- Changing HTML rendering
- Changing type definitions
- Test refactoring (tests stay in `server.test.ts` unless there is a clear reason to split)
