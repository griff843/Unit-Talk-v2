# UTV2-1480 Diff Summary

## Summary

UTV2-1480 fixes workflow configuration drift in the live database operations workflows.

## Files changed

- `.github/workflows/db-health-tripwire.yml` — pins `pnpm/action-setup` to the repo package manager version (`10.29.3`), names setup steps consistently, and routes the live DB connection through the existing `supabase-pooler-url` selector so the scheduled read-only tripwire prefers `SUPABASE_DB_POOLER_URL` while preserving the existing `SUPABASE_DB_URL` consumer contract for `scripts/ops/db-health-tripwire.ts`.
- `.github/workflows/live-schema-parity.yml` — updates fail-closed comments and error text so required parity configuration reflects the accepted pooler-or-direct secret contract.
- `.github/workflows/schema-baseline-dump.yml` — updates baseline-generator commentary to identify `SUPABASE_DB_POOLER_URL` as the preferred CI DB connection secret.
- `.github/workflows/deploy.yml` — reviewed for this lane; no edit required because its pnpm/Node setup is already aligned and it does not invoke raw Postgres workflow checks.

## Scope

No application code, package code, migrations, generated DB types, or runtime delivery paths were changed.
