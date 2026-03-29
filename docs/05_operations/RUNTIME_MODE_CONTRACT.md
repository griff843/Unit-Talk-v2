# Runtime Mode Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-147)
**Authority:** This document defines the canonical runtime mode semantics for all Unit Talk V2 services.

---

## Problem

Each service independently implements dev/test/prod behavior with inconsistent patterns:
- `apps/api`: catches credential load failure and silently falls back to InMemory repos
- `apps/operator-web`: similar silent fallback
- `apps/worker`: own ad-hoc env checks
- No shared `RuntimeMode` type or `getRuntimeMode()` helper

This means adding a new service requires reinventing the mode contract, and auditing prod-safety requires checking each service file independently.

---

## Runtime Modes

| Mode | `UNIT_TALK_APP_ENV` value | Behavior |
|------|--------------------------|----------|
| `development` | `development` (or absent) | InMemory repos allowed. Silent fallback allowed. Discord dry-run default. |
| `test` | `test` | InMemory repos required. No DB connections. No Discord calls. |
| `staging` | `staging` | Database repos required. Fail-closed on missing credentials. Discord live optional. |
| `production` | `production` | Database repos required. Fail-closed on missing credentials. Discord live required. |

---

## Fail-Closed Rule

**In `staging` and `production` modes:**
- If Supabase credentials (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are missing or invalid, the service **must exit(1)** at startup — not fall back to InMemory.
- A startup log line must clearly state the persistence mode: `{ "persistenceMode": "database" }` or `{ "persistenceMode": "in_memory" }`.
- Silent fallback to InMemory in staging/production is a **hard violation** of this contract.

**In `development` and `test` modes:**
- InMemory fallback is permitted and expected.
- Credential absence is not an error.

---

## `@unit-talk/config` Helper (Codex: UTV2-147)

Add to `packages/config/src/env.ts`:

```typescript
export type RuntimeMode = 'development' | 'test' | 'staging' | 'production';

export function getRuntimeMode(env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  const raw = env['UNIT_TALK_APP_ENV'] ?? env['NODE_ENV'] ?? 'development';
  if (raw === 'production') return 'production';
  if (raw === 'staging') return 'staging';
  if (raw === 'test') return 'test';
  return 'development';
}

export function isProductionLike(mode: RuntimeMode): boolean {
  return mode === 'production' || mode === 'staging';
}
```

---

## Per-Service Startup Behavior

### `apps/api`

```typescript
// In createApiRuntimeDependencies():
const mode = getRuntimeMode();

if (isProductionLike(mode) && !options.repositories) {
  // Credentials MUST be present — no silent fallback
  const environment = loadEnvironment();       // throws if missing
  const connection = createServiceRoleDatabaseConnectionConfig(environment);
  return {
    repositories: createDatabaseRepositoryBundle(connection),
    persistenceMode: 'database',
  };
}

// development / test: fallback allowed
try {
  const environment = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(environment);
  return { repositories: createDatabaseRepositoryBundle(connection), persistenceMode: 'database' };
} catch {
  return { repositories: createInMemoryRepositoryBundle(), persistenceMode: 'in_memory' };
}
```

### `apps/operator-web`

Same pattern as API: fail-closed in staging/production, fallback allowed in development/test.

### `apps/worker`

Same pattern. `UNIT_TALK_WORKER_AUTORUN` gating is separate from credential validation.

### `apps/discord-bot`

`DISCORD_BOT_TOKEN` must be present in staging/production. Missing token in staging/production = exit(1).

---

## Env Var Reference

| Var | Purpose |
|-----|---------|
| `UNIT_TALK_APP_ENV` | Primary runtime mode selector |
| `NODE_ENV` | Fallback (standard Node convention) |
| `SUPABASE_URL` | Required in staging/production |
| `SUPABASE_SERVICE_ROLE_KEY` | Required in staging/production |
| `DISCORD_BOT_TOKEN` | Required in staging/production for discord-bot |

---

## Acceptance Criteria (UTV2-147)

- [ ] `getRuntimeMode(env)` exported from `@unit-talk/config`
- [ ] `isProductionLike(mode)` exported from `@unit-talk/config`
- [ ] `apps/api` `createApiRuntimeDependencies` uses `getRuntimeMode()` and fails closed in staging/production
- [ ] `apps/operator-web` startup uses `getRuntimeMode()` and fails closed in staging/production
- [ ] New test: API startup exits with error when in production mode and Supabase credentials are absent
- [ ] New test: API startup uses InMemory when in development mode and Supabase credentials are absent
- [ ] `pnpm verify` passes

---

## Relationship to UTV2-115, UTV2-116

UTV2-115 (fail-closed API) and UTV2-116 (fail-closed operator-web) are the first implementations of this contract. They may proceed in parallel with this contract being written — but once this contract is ratified, they must align with it. If UTV2-115/116 were merged before this contract was written, they should be verified to conform on the next review pass.
