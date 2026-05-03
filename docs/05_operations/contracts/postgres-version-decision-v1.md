# Postgres Version Decision — v1

**Status:** APPROVED
**Issue:** UTV2-779
**Decision:** Postgres 16
**Decided by:** PM (griff843), 2026-05-03

---

## 1. Decision

**Default: Postgres 16 (PG16)**

Do not provision the EX44 production DB on Postgres 17 unless a specific feature or operational benefit justifies the deviation and PM approves it explicitly.

---

## 2. Rationale

| Factor | PG16 | PG17 | Assessment |
|--------|------|------|------------|
| Release date | Sept 2023 | Oct 2024 | PG16 has ~18 months production mileage |
| Stability | Battle-tested | Newer | PG16 preferred for first self-hosted prod |
| Unit Talk feature requirements | All satisfied | No new features needed | No PG17 features are in scope |
| Supabase source compatibility | Same or one-hop up | Two hops up | PG16 migration is simplest |
| Extension ecosystem | Fully stable | Mostly stable | PG16 safer |
| Backup tooling (WAL-G, pgBackRest) | Full support | Supported | Both work; PG16 more tested in practice |
| `pg_stat_statements` | Available | Available | No difference |
| Upgrade path to PG17 | Straightforward when ready | — | Can upgrade later with pg_upgrade |

No PG17-specific feature (e.g., `COPY FROM WHERE`, logical replication improvements, vacuum improvements) is required by the current implementation scope. Upgrading later is lower risk than starting on a newer major version.

---

## 3. Extension compatibility

| Extension | PG16 | Notes |
|-----------|------|-------|
| `pg_stat_statements` | ✅ | Core contrib, always available |
| `pg_trgm` | ✅ | Used for fuzzy alias matching |
| `uuid-ossp` | ✅ | Used in migrations for gen_random_uuid() |
| `btree_gist` | ✅ | Available |
| PostGIS | ✅ | Not currently in scope but available |

All extensions used in existing migrations are available and stable on PG16.

---

## 4. Migration / export / import compatibility with Supabase

Supabase projects currently run PG15 or PG16.

| Scenario | Compatibility | Notes |
|----------|--------------|-------|
| Supabase PG15 → Hetzner PG16 | ✅ | One major version forward — pg_dump/restore supported |
| Supabase PG16 → Hetzner PG16 | ✅ | Same major version — direct dump/restore |
| Supabase PG15/16 → Hetzner PG17 | ⚠️ | Works but adds unnecessary risk |

The forward migration runbook (UTV2-788) must use `pg_dump` with `--no-password` and explicit schema/role handling. PG16 to PG16 is the safest path.

---

## 5. Backup tooling compatibility

| Tool | PG16 support | Notes |
|------|-------------|-------|
| WAL-G 3.0+ | ✅ | Full WAL archiving + base backup |
| pgBackRest 2.52+ | ✅ | Full PITR support |
| pg_basebackup | ✅ | Bundled with PG16 server |

Tool selection (WAL-G vs pgBackRest) is a separate decision tracked in UTV2-791. Both support PG16 fully.

---

## 6. Upgrade path

When upgrading to PG17 becomes justified:

1. Run `pg_upgrade --check` to verify compatibility before any upgrade
2. Perform upgrade on a cloned standby first, not on primary
3. Require WAL/PITR restore proof on PG17 before promoting
4. Requires new version of this document (`postgres-version-decision-v2.md`) with PM approval

No upgrade should happen during the initial cutover window. Stabilise on PG16 first.

---

## 7. Provisioning instruction

When provisioning the EX44 DB server:

```bash
# Install PostgreSQL 16 from PGDG
apt-get install -y postgresql-16 postgresql-client-16

# Verify version
psql --version  # must output: psql (PostgreSQL) 16.x
```

Do not install PG17 packages. If the OS default provides a different version, pin explicitly to `postgresql-16`.
