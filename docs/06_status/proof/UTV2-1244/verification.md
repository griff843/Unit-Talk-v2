# UTV2-1244 Verification — Migration Index provider_offer_history

## Summary

T1 migration lane. Adds `idx_provider_offer_history_event_snapshot` on
`provider_offer_history(provider_event_id, snapshot_at)` for efficient event
lookups. Index applied to live Supabase (project `zfzdnfwdarxucxtaojxm`) and
confirmed present.

## Verification

`pnpm type-check` — PASS

`pnpm test` — PASS (113 pass, 0 fail)

`pnpm verify` — PASS

`pnpm test:db` — 7/7 pass:

```
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 125960.570
```

`scripts/ci/r-level-check.ts` — PASS (3 changed files, no R-level triggers)

## Pre-Check: Index State Before Migration

Query run against `zfzdnfwdarxucxtaojxm`:
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'provider_offer_history'
ORDER BY indexname;
```

Result (2 rows — no provider_event_id index):
| indexname | indexdef |
|---|---|
| provider_offer_history_pkey | UNIQUE btree (snapshot_at, id) |
| provider_offer_history_snapshot_idempotency_key | UNIQUE btree (snapshot_at, idempotency_key) |

Row count: **713,978** (confirmed pre-migration)

## Migration Application

Migration applied to live Supabase via `apply_migration` MCP:

```sql
CREATE INDEX IF NOT EXISTS idx_provider_offer_history_event_snapshot
  ON public.provider_offer_history (provider_event_id, snapshot_at);
```

Result: `{"success": true}`

Note: `IF NOT EXISTS` ensures CI deploy via Supabase CLI (which uses `CONCURRENTLY`)
is idempotent — the migration file in the repo uses `CREATE INDEX CONCURRENTLY IF NOT EXISTS`.

## Post-Check: Index Confirmed Present

Query run against `zfzdnfwdarxucxtaojxm` after migration:
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'provider_offer_history'
ORDER BY indexname;
```

Result (3 rows — new index present):
| indexname | indexdef |
|---|---|
| **idx_provider_offer_history_event_snapshot** | **btree (provider_event_id, snapshot_at)** |
| provider_offer_history_pkey | UNIQUE btree (snapshot_at, id) |
| provider_offer_history_snapshot_idempotency_key | UNIQUE btree (snapshot_at, idempotency_key) |

## CONCURRENTLY Note

`provider_offer_history` is a partitioned table (`PARTITION BY RANGE(snapshot_at)`).
PostgreSQL does not support `CREATE INDEX CONCURRENTLY` on the parent of a partitioned
table — this is a hard PostgreSQL limitation confirmed by the CI round-trip drill error:
`"cannot create index on partitioned table 'provider_offer_history' concurrently"`.

The migration file uses `CREATE INDEX IF NOT EXISTS` (without CONCURRENTLY). This is
correct and safe:
- For production CLI deploy (`supabase db push`): index already exists (`IF NOT EXISTS`
  is a no-op), so no table lock during apply.
- For a fresh-install database: the `IF NOT EXISTS` form takes a brief `ShareLock` (not
  `AccessExclusiveLock`), acceptable for index creation.
- For the schema round-trip drill on scratch Postgres: runs correctly without CONCURRENTLY.

## R-Level

```
Verdict: PASS
Changed files: 3
Rules matched: (none) — migration-only diff, no R1-R5 triggers
```

## SHA Binding

Verified source SHA: `1a7e4b28a6390f2fe0c91f9034393252336ae977` (last non-proof commit — CONCURRENTLY removal).
Merge SHA: PENDING — update post-merge before lane close.
