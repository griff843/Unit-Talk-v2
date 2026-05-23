# db/migrations-rollback

Constitutional reversible migration framework (UTV2-1083).

## Convention

Every migration in `supabase/migrations/<basename>.sql` must have a corresponding
down script at `db/migrations-rollback/<basename>.down.sql`.

The CI gate `migration-reversibility-gate` enforces this on every PR that adds
a migration file. PRs adding a migration without a matching down script fail closed.

## Down script requirements

A down script must:

1. Be executable SQL (not just comments).
2. Either fully revert the migration's schema changes, OR contain the marker
   `-- IRREVERSIBLE:` with a rationale and a reference to the PITR runbook.
3. Survive a round-trip drill: apply the up migration, apply the down script,
   re-apply the up migration — the schema hash must match before and after.

## Irreversible migrations

Some migrations (data backfills, destructive function rewrites) cannot be
mechanically reversed without data loss. For these, add the down script with:

```sql
-- IRREVERSIBLE: <reason>
-- Constitutional rollback procedure: PITR.
-- Refer to docs/05_operations/DB_ROLLBACK_RUNBOOK.md.
```

The CI gate accepts this marker. The round-trip drill skips the schema hash check
for IRREVERSIBLE migrations and emits an advisory warning instead.

## Pre-constitutional baseline

Migrations 202603200001 through 202605140001 (107 migrations) are the
pre-constitutional baseline. Down scripts for these migrations are provided
on a best-effort basis. New migrations added after UTV2-1083 merges must have
a down script as a hard gate.

## Schema round-trip hash

`scripts/ci/schema-roundtrip-hash.ts` captures the Postgres public schema DDL
as a SHA-256 hash for drill verification. Requires `pg_dump` and a connection
string via `SUPABASE_DB_URL` or `POSTGRES_URL`.
