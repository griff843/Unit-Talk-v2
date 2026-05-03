# Postgres Least-Privilege Role Model — UTV2-789

**Authority:** This document defines the Postgres role model for the Hetzner self-hosted deployment. Runtime services must use these roles. Superuser credentials are forbidden in runtime connection strings.

---

## Role Overview

| Group Role | Login Role | Services | Access Level |
|---|---|---|---|
| `app_user` | `ut_app_runtime` | apps/api, apps/worker, apps/alert-agent | Pick pipeline, outbox, receipts, settlements, audit |
| `ingestion_writer` | `ut_ingestion_runtime` | apps/ingestor | Provider data, game data, reference data |
| `scanner_user` | `ut_scanner_runtime` | Pick scanner, scoring services | Read ingestion data, write pick_candidates |
| `metrics_user` | `ut_metrics_runtime` | apps/command-center, monitoring scripts | Read-only observability |
| `migration_owner` | `ut_migration_runtime` | Migration runs only (not runtime) | DDL + all tables |

**No runtime service uses superuser credentials.** `migration_owner` is only for maintenance windows.

---

## Table Access Matrix

| Table | app_user | ingestion_writer | scanner_user | metrics_user | migration_owner |
|---|---|---|---|---|---|
| `picks` | RW | — | R | R | ALL |
| `pick_candidates` | R | — | RW | R | ALL |
| `distribution_outbox` | RW | — | — | R | ALL |
| `distribution_receipts` | RW | — | — | R | ALL |
| `settlement_records` | RW | — | — | R | ALL |
| `audit_log` | RW | — | — | R | ALL |
| `alert_detections` | RW | — | — | R | ALL |
| `hedge_opportunities` | RW | — | — | — | ALL |
| `system_runs` | RW | RW | — | R | ALL |
| `provider_offers` | R | RW | R | R | ALL |
| `provider_offer_current` | R | RW | R | — | ALL |
| `provider_offer_history` | — | RW | — | — | ALL |
| `provider_offer_staging` | — | RW | — | — | ALL |
| `provider_cycle_status` | — | RW | — | — | ALL |
| `market_universe` | R | — | R | — | ALL |
| `events`, `event_participants` | R | RW | R | — | ALL |
| `players`, `teams`, `leagues` | R | RW | R | — | ALL |
| Reference tables | R | RW | R | — | ALL |
| `member_tiers` | RW | — | — | R | ALL |

**R** = SELECT only. **RW** = SELECT, INSERT, UPDATE. **ALL** = full DDL + DML. **—** = no access.

---

## Provisioning

### Step 1: Apply group roles and grants

```bash
psql $DATABASE_URL -f scripts/postgres/roles.sql
```

This creates the five group roles and grants table-level permissions. Idempotent — safe to re-run.

### Step 2: Create login roles with passwords

Set passwords in the environment, then run:

```bash
export UT_APP_PASSWORD=<strong-random-password>
export UT_INGESTION_PASSWORD=<strong-random-password>
export UT_SCANNER_PASSWORD=<strong-random-password>
export UT_METRICS_PASSWORD=<strong-random-password>
export UT_MIGRATION_PASSWORD=<strong-random-password>

bash scripts/postgres/provision-roles.sh
```

Passwords are never stored in code — they come from the environment only.

### Step 3: Validate

```bash
psql $DATABASE_URL -f scripts/postgres/validate-roles.sql
```

Check the output:
- All five group roles listed with `rolcanlogin = false`
- All login roles listed with their group memberships
- Superuser check shows `rolsuper = false` for all login roles
- `metrics_user` has no INSERT/UPDATE/DELETE grants on any table

---

## Connection String Updates

Update each service's `DATABASE_URL` or `SUPABASE_URL`-equivalent to use the login role:

| Service | Role | Example DSN fragment |
|---|---|---|
| apps/api | `ut_app_runtime` | `postgres://ut_app_runtime:<pw>@<host>:5432/unit_talk` |
| apps/worker | `ut_app_runtime` | same as api |
| apps/alert-agent | `ut_app_runtime` | same as api |
| apps/ingestor | `ut_ingestion_runtime` | `postgres://ut_ingestion_runtime:<pw>@<host>:5432/unit_talk` |
| apps/command-center | `ut_metrics_runtime` | `postgres://ut_metrics_runtime:<pw>@<host>:5432/unit_talk` |
| Migration runs | `ut_migration_runtime` | `postgres://ut_migration_runtime:<pw>@<host>:5432/unit_talk` |

Connection string changes to `local.env` / deployment secrets require PM approval (always-escalate: environment variable changes).

---

## No-go Conditions

Before production cutover:
- No service may connect using `postgres` (superuser) or any account with `rolsuper = true`
- `ut_migration_runtime` must not appear in any service's runtime connection string
- `metrics_user` grants must not include INSERT, UPDATE, or DELETE on any table

---

## Verification Script

```bash
# TypeScript evaluator (runs against the connected DB)
npx tsx scripts/db-role-validator.ts

# SQL validation (run directly on the Hetzner instance as superuser)
psql $DATABASE_URL -f scripts/postgres/validate-roles.sql
```

---

## Related

- `scripts/postgres/roles.sql` — group role definitions and grants
- `scripts/postgres/provision-roles.sh` — login role provisioner
- `scripts/postgres/validate-roles.sql` — SQL validation queries
- `scripts/db-role-validator.ts` — TypeScript DB role checker
- `docs/05_operations/WALPITR_RESTORE_RUNBOOK.md` — companion backup runbook (UTV2-782)
- `UTV2-770` — Hetzner cutover gate (this blocks it)
