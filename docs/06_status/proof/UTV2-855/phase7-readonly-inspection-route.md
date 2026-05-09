# UTV2-855 Phase 7 Read-only Inspection Route

Generated: 2026-05-08T08:48:43.9504214-04:00
Mode: read-only route restoration

## Result

A trustworthy authoritative read-only Supabase schema inspection route is now restored.

## Route status

### 1. Supabase MCP `execute_sql`

- Status: **failed**
- Reason: no callable Supabase `execute_sql` MCP tool is available in this session

This was the preferred route, but it is not currently present in the active or discoverable tool surface here.

### 2. Pooler-based read-only connectivity

- Pooler host: `aws-1-us-west-2.pooler.supabase.com`
- Port: `5432`
- TCP probe: **succeeds**
- Status: **usable through Docker-backed PostgreSQL tooling**

What worked:

- `Test-NetConnection` to the pooler host on port `5432` succeeded

What still fails on the host:

- no local `psql` binary is installed
- no local `pg_dump` binary is installed
- direct DB-host access via `SUPABASE_DB_URL` still fails DNS resolution on `db.zfzdnfwdarxucxtaojxm.supabase.co`

Net result:

- the network path to the pooler is alive
- and harmless read-only SQL **was** executed successfully by running a disposable PostgreSQL client in Docker
- so the pooler route is now **proven reliable when paired with Docker**

### 3. Docker-backed `supabase db dump`

- Status: **works**

Proof:

- Docker server version: `29.3.1`
- Harmless read-only query succeeded via disposable `postgres:17-alpine` container:
  - `select current_database(), current_schema(), now();`
  - result: `postgres|public|2026-05-08 12:48:04.715258+00`
- Schema-only dump succeeded through the Supabase pooler
- Dump artifact:
  - [utv2-855-phase7-public-schema.sql](C:/Dev/Unit-Talk-v2-main/.temp/utv2-855-phase7-public-schema.sql)
- Dump facts from the artifact header:
  - dumped from database version `17.6`
  - dumped by `pg_dump` version `17.9`

This route is now the authoritative read-only inspection path for rerunning Phase 6.

## Which route works

Docker-backed PostgreSQL inspection through the Supabase pooler works and is trustworthy for read-only schema audit.

## Which routes failed

- Supabase MCP `execute_sql` - unavailable in session
- Host-local pooler-based SQL tooling - TCP reachable, but no host-installed `psql` / `pg_dump`

## Exact failure reasons

- **MCP route:** no Supabase SQL execution tool is present
- **Host-local pooler route:** connection target is reachable, but host-local SQL tooling is missing and direct DB-host DNS is still broken

## Can Phase 6 be rerun?

**Yes.**

Phase 6 can now use the restored Docker-backed route, which already proved both harmless read-only SQL execution and authoritative schema-only dumping against the linked Supabase environment.

## Recommended next operator action

Proceed to rerun Phase 6 using the restored Docker-backed read-only inspection path.

## No writes performed

Confirmed:

- no `supabase db push`
- no `supabase migration repair`
- no live `ALTER TABLE`
- no schema reset
- no preview branch creation
- no migration-ledger mutation
- no historical ownership mutation
