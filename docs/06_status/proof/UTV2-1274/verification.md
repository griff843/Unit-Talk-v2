# UTV2-1274 — Live Schema Parity end-to-end (Option B baseline) — Verification

**Tier:** T1 · **Lane type:** migration · **Status:** COMPLETE
**SHA binding:** `35b35b128948216d92f6719ef274a3b4ad56cf17` (baseline-adoption commit)

## Verification

Live Schema Parity now runs end-to-end and reaches a real, fail-closed verdict.

### Runtime proof (against real live Supabase)

- **Live Schema Parity run:** https://github.com/griff843/Unit-Talk-v2/actions/runs/27524264024 — `success`.
  - Boots a Supabase local stack (Postgres 17, Supabase-shaped: auth/storage/extensions
    schemas + roles), applies the repo migrations (now just the baseline) via `supabase db reset`.
  - Connects to **live** Supabase (project `zfzdnfwdarxucxtaojxm`) over the IPv4 session-mode
    Supavisor pooler and compares the scratch schema to live.
  - **Drift gate verdict: PASS** (exit 0). 0 unauthorized findings. 2 allowed findings.

| Collection | drift |
|---|---|
| relations | 0 |
| columns | 0 |
| constraints | 0 |
| indexes | 0 |
| policies | 0 |
| triggers | 0 |
| extensions | 2 (both allowlisted) |

Allowlisted (deny-by-default everywhere else):
- `extensions.pg_net` — default on the local stack, not on live.
- `pg_catalog.pg_cron` — on live (scheduled partition lifecycle), not on the local stack.

### Baseline generation (read-only, schema-only)

- **Schema Baseline Dump run:** https://github.com/griff843/Unit-Talk-v2/actions/runs/27524035425 — `success`.
  - `pg_dump --schema-only --no-owner --no-privileges --schema=public` of live in a
    `postgres:17` container via the session pooler. Read-only; **no table data dumped**
    (0 INSERT/COPY statements); no live mutation; DB URL never printed.
  - Sanitized for the migration runner (`\restrict`/`\unrestrict` stripped, `CREATE SCHEMA`
    made idempotent), then **replayed alone from scratch** on the local stack — clean.
  - Dynamic `provider_offer_history_p<YYYYMMDD>` partition children excluded; parent
    partitioned table, its management function, and `provider_offer_history_compact` retained.
  - Baseline: `supabase/migrations/00000000000000_baseline_live_schema.sql` — 58 tables,
    33 functions, 171 indexes.

### Ledger reset

- The 122 pre-baseline migrations were moved to `supabase/migrations_archive/` (provenance
  only; not applied by any automation) with a boundary README.
- The baseline is the forward-only replay root; future migrations are added after it.

### Reversibility

- Baseline is **IRREVERSIBLE** (a schema snapshot has no meaningful down; PITR is recovery).
  Down marker: `db/migrations-rollback/00000000000000_baseline_live_schema.down.sql`;
  PM-ratified exemption in `db/migrations-rollback/irreversible-exemption-registry.json`.

### Static checks

- `pnpm verify` green on the branch (fixed the stale parity workflow-shape assertion that
  was the sole pre-existing failure).
- `filterSnapshot` partition-exclusion unit tests pass (4/4).

### Fail-closed posture preserved

The drift gate remains deny-by-default; a missing/unreachable DB or a skipped parity run on a
required ref is treated as FAIL (D-CONST-4/7). The check was not downgraded.
