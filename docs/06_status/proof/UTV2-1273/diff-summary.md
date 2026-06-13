# UTV2-1273 — Diff Summary

**Branch:** `claude/utv2-1273-schema-parity-scratch-ssl` · **Lane type:** runtime · **Tier:** T2
**Base:** `3ec71b27` (main)

Narrow infra cleanup: make the Live Schema Parity CI actually run, instead of failing on a
missing secret / unmasked TLS error.

## Two-part fix

1. **Provisioned the `SUPABASE_DB_URL` GitHub Actions secret** (the original UTV2-1273 ask) via
   `gh secret set` (value piped from the operator env, never printed). The `check-config` job now
   reports `db-configured=true` and the missing-secret fail-closed gate no longer fires.

2. **Workflow one-line fix** (this PR): added `?sslmode=disable` to the **scratch** `EXPECTED_DATABASE_URL`.
   Provisioning the secret unmasked a latent bug — the `schema-parity` job (previously skipped when the
   secret was absent) now runs `supabase db push --db-url <scratch>` against the local `postgres:17`
   service container, which serves no TLS, so the Supabase CLI failed with
   `tls error (server refused TLS connection)`. Disabling TLS for the **local scratch** URL only fixes this;
   the live `ACTUAL_DATABASE_URL` (Supabase secret) is untouched and keeps its own TLS.

## Change

| File | Change |
|---|---|
| `.github/workflows/live-schema-parity.yml` | `EXPECTED_DATABASE_URL` (local scratch DB) gains `?sslmode=disable` so `supabase db push` / `pg_isready` / `db:compare` connect to the non-TLS scratch Postgres. One line + comment. |

## Out of scope
- No schema migration, no production data mutation, no `ACTUAL_DATABASE_URL` change.
- The secret value is never printed in logs, comments, or artifacts.
