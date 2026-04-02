# Supabase Connection Strategy

**Status:** RATIFIED  
**Date:** 2026-04-02  
**Linear:** UTV2-305  
**Tier:** T1 — Architecture / Operations

---

## Decision Summary

| Use Case | Connection Method | Client |
|----------|------------------|--------|
| Application runtime (API, worker, ingestor) | REST API via `@supabase/supabase-js` | `SUPABASE_URL` + `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` |
| Migrations, schema changes | Direct SQL via Supabase CLI (`supabase db push`) | `SUPABASE_ACCESS_TOKEN` + project ref |
| Type generation | Supabase CLI (`supabase gen types`) | `SUPABASE_ACCESS_TOKEN` + `--linked` |
| Admin/debug queries | Supabase Dashboard SQL editor or CLI | Dashboard session or `SUPABASE_ACCESS_TOKEN` |
| Connection pooler (pgBouncer) | Not currently used — deferred | — |

---

## Why REST API (Not Direct pg Connection)

Unit Talk V2 uses `@supabase/supabase-js` (the Supabase JS client) for all application-layer DB access. This uses Supabase's PostgREST REST API layer, not a raw pg/pg-pool connection.

**Rationale:**
1. **PostgREST handles pooling** — the REST layer manages connection pooling via PostgREST internally. No connection pool configuration required in the application.
2. **RPC functions** — submission, settlement, and delivery confirmation use Supabase RPC (`supabase.rpc(...)`) for transactional safety. This requires the REST layer.
3. **Type safety** — `@supabase/supabase-js` consumes `database.types.ts` for end-to-end TypeScript inference via `createClient<Database>()`.
4. **Serverless-compatible** — the REST API is stateless; no persistent connection required. This matches the worker's polling model and the API server's request-per-handler model.

**When this breaks down:** Very high concurrency (1000+ concurrent requests) may benefit from a connection pooler. At Unit Talk V2's current scale (single-capper, polling-based), this is not a concern.

---

## Connection Credentials

### Application runtime

```
SUPABASE_URL         = https://feownrheeefbcsehtsiw.supabase.co
SUPABASE_ANON_KEY    = (public, safe for browser — used by smart-form)
SUPABASE_SERVICE_ROLE_KEY = (secret, server-only — used by API, worker, ingestor)
```

- **Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser or smart-form**
- `apps/api`, `apps/worker`, `apps/ingestor`, `apps/operator-web` all use service role key
- `apps/smart-form` uses anon key (no direct DB access — posts to API)

### CLI operations

```
SUPABASE_ACCESS_TOKEN = sbp_... (personal access token from Supabase dashboard)
SUPABASE_PROJECT_REF  = feownrheeefbcsehtsiw
```

Required for:
- `supabase link --project-ref feownrheeefbcsehtsiw`
- `supabase db push` (apply migrations)
- `pnpm supabase:types` (regenerate database.types.ts)

---

## Connection Pooler (pgBouncer) — Deferred

Supabase provides a connection pooler (pgBouncer) accessible via a separate connection string:
```
postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

This is **not currently used** in Unit Talk V2.

**When to adopt the pooler:**
- If the application migrates from `@supabase/supabase-js` REST to a raw `pg` or `drizzle-orm` connection
- If connection exhaustion errors appear in production (`remaining connection slots are reserved`)
- If a serverless deployment model (Lambda, Edge functions) is adopted where each invocation would open a new connection

**If pooler is adopted, it requires:**
1. A separate `DATABASE_URL` env var (connection string format, not REST URL)
2. Replacing `@supabase/supabase-js` RPC calls with raw SQL or a query builder
3. Handling transactions explicitly (no Supabase RPC abstraction)
4. Updating all `RepositoryBundle` implementations

This is a significant migration — do not adopt the pooler without an explicit ADR.

---

## Direct SQL (Migrations and Schema Changes)

All schema changes go through Supabase migration files:
```
supabase/migrations/YYYYMMDDNNNN_description.sql
```

Apply via:
```bash
supabase db push --linked
# or
supabase db push --project-ref feownrheeefbcsehtsiw
```

Never apply schema changes directly via:
- Supabase Dashboard "Table Editor"
- Raw `psql` session
- `supabase.rpc('alter_table', ...)` or similar

The migration file is the source of schema truth. The Dashboard SQL editor is acceptable for one-off queries and debugging only.

---

## Type Generation Pipeline

After applying migrations:

```bash
pnpm supabase:types
# → supabase gen types typescript --linked --schema public | tail -n +2
# → overwrites packages/db/src/database.types.ts
```

Then:
```bash
pnpm type-check  # must pass before committing
```

`packages/db/src/database.types.ts` is committed to the repo so CI can type-check without a live Supabase connection.

**Do not hand-edit `database.types.ts`** — it will be clobbered on the next regen.

---

## Local Development

Supabase provides a local emulator via Docker:

```bash
supabase start         # start local Supabase stack
supabase db reset      # replay all migrations against local
```

Use `SUPABASE_URL=http://127.0.0.1:54321` and the local `anon`/`service_role` keys printed by `supabase start` for local development.

**Caution:** Local Supabase uses a different database instance. Do not run `pnpm test:db` against the local stack unless you explicitly point it at the local URL — `test:db` targets the live project by default via `local.env`.

---

## Key Failure Modes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `relation "table_name" does not exist` | Migration not applied to live project | Run `supabase db push --linked` |
| PostgREST 500 on table query after migration | Schema cache stale | Run `SELECT pg_catalog.pg_reload_conf()` or restart PostgREST via Supabase dashboard |
| `permission denied for function rpc_name` | Missing `GRANT EXECUTE` on RPC function | Add `GRANT EXECUTE ON FUNCTION rpc_name TO service_role` in migration |
| Type errors after migration | `database.types.ts` not regenerated | Run `pnpm supabase:types` then `pnpm type-check` |
| `remaining connection slots are reserved` | Connection exhaustion (unlikely at current scale) | Investigate open connections; consider pooler if persistent |

---

## Cross-References

- `docs/05_operations/supabase_setup.md` — initial setup, canonical table list, schema decisions
- `supabase/migrations/` — migration source of truth
- `packages/db/src/database.types.ts` — generated types (do not hand-edit)
- `packages/db/src/types.ts` — derived row types
