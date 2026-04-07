---
title: Runtime Restart and Deploy Discipline
status: active
owner: operations
last_updated: 2026-04-07
---

# Runtime Restart and Deploy Discipline

## Document Type

- Operations SOP
- Scope: local, dev, and staging runtime truth discipline for API, Smart Form, and operator surfaces

## Purpose

Prevent stale processes, port collisions, and false proofs caused by old app instances continuing to serve traffic after code changes or verification runs.

## Problem This SOP Solves

A known deviation exists where a Smart Form zombie process can remain active on port `4100`. This creates a risk that:

- UI traffic is served by an old build
- proofs appear inconsistent with current source
- verification results are contaminated by stale runtime state

## Operating Principles

- One runtime per surface - no duplicate app instances serving the same port
- Runtime truth beats assumption - never assume a new build is serving traffic until verified
- Fail closed on collision - if the expected port is already in use, treat as suspicious until confirmed
- Proof must name runtime source - all proof bundles should make clear which process or container served the result

## Required Checks Before Starting Services

### Port Checks

Verify required ports are not occupied unexpectedly.

Example ports to verify:

- API port
- Smart Form port `4100`
- Command Center and operator surface ports as applicable

### Process Checks

Confirm there are no orphaned Node, Vite, Next, or containerized app instances serving old builds.

### Environment Checks

Confirm the expected environment and runtime target are active before launching services.

## Start Procedure

1. Confirm no stale process is bound to required service ports.
2. Launch services using the canonical project start path only.
3. Wait for health and readiness indicators.
4. Open the intended route and verify the expected build/runtime identity.
5. Record launch evidence if part of a governed sprint or proof run.

## Restart Procedure

Use this procedure whenever:

- code affecting runtime surfaces changed
- a proof run is about to begin
- a route appears stale or inconsistent
- a port collision is detected

Steps:

1. Stop the target service cleanly.
2. Confirm the port is actually released.
3. Kill any orphaned process still holding the port.
4. Relaunch using the canonical command path.
5. Re-verify runtime identity and health endpoint/output.

## Deploy / Verification Discipline

Before any milestone proof or operator verification:

- restart affected runtime surfaces
- verify health endpoints
- confirm the current code path is the one serving requests
- do not reuse an already-running instance without explicit validation

## Failure Conditions

Treat the following as hard-stop conditions:

- expected port is occupied by an unknown process
- UI output does not reflect current code changes
- health/readiness is missing or inconsistent
- more than one process can plausibly serve the same surface

## Required Evidence For Governed Proof

For proof-quality runs, capture:

- service start command used
- port ownership confirmation
- health/readiness confirmation
- endpoint or UI response showing current runtime state
- note of any restart or stale-process remediation performed

## Migration Rollback Procedure

Use this procedure when a migration must be reverted from the live Supabase project.

**When to trigger:**
- A migration applied to live introduces a regression discovered in the same session
- PM or operator explicitly authorizes rollback
- Never self-authorize — confirm with PM before executing

**Step 1 — Identify the head migration**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase migration list --linked
# or: pnpm migration:audit
```

Confirm which migration is being rolled back. Never roll back more than one migration without PM approval per migration.

**Step 2 — Back up the current schema state**

```bash
# Dump current schema only (no data) for reference
SUPABASE_ACCESS_TOKEN=<token> npx supabase db dump --schema-only -f schema-backup-$(date +%Y%m%d%H%M).sql
```

**Step 3 — Apply the reverse migration manually via Supabase SQL editor**

There is no `supabase migration down` command in the hosted project. Roll back by:

1. Opening the Supabase dashboard → SQL editor
2. Manually running the inverse of the migration's DDL (e.g., `ALTER TABLE ... DROP COLUMN IF EXISTS` for an `ADD COLUMN` migration)
3. Documenting the exact SQL executed and the timestamp

**Step 4 — Mark the migration as unapplied in the tracking table**

```sql
-- Run in SQL editor after the reverse DDL is applied
DELETE FROM supabase_migrations.schema_migrations WHERE name = '<migration_timestamp>';
```

**Step 5 — Regenerate types and verify**

```bash
pnpm supabase:types
pnpm type-check
pnpm test
```

Confirm the type file line count and test suite are clean after the rollback.

**Step 6 — Record the incident**

Add a note to `docs/05_operations/migration_ledger.md` documenting:
- which migration was rolled back
- why
- what inverse SQL was applied
- who authorized

Do not delete the migration file from `supabase/migrations/`. Rename it with a `.rolled-back` suffix and add a comment at the top.

---

## Future Hardening Recommendations

- container-only runtime for governed verification
- canonical stop/start script for all app surfaces
- automatic port preflight checks that fail closed
- runtime identity banner or build stamp for operator-facing surfaces
