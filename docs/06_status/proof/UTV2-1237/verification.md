# UTV2-1237 — Verification

## Verification

Docs-only architecture lane. Verification scope per repo policy for governance/docs lanes:

### Document deliverable

- `docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md` created — hot/cold boundary, retention windows, Parquet export conveyor, fail-closed archive-manifest prune gate, DuckDB restore/query story, consumer-inventory prerequisites, short-term risk assessment, four bounded follow-up lanes.

### Live-DB measurements grounding the design (executed 2026-06-11)

```sql
select c.relname, pg_size_pretty(pg_total_relation_size(c.oid)), coalesce(s.n_live_tup,0)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
left join pg_stat_user_tables s on s.relid=c.oid
where n.nspname='public' and c.relkind in ('r','p')
order by pg_total_relation_size(c.oid) desc limit 12;
-- provider_offers_legacy_quarantine 6531 MB; system_runs 1131 MB;
-- provider_offer_current 230 MB; history partitions 79–218 MB/day; raw_payloads 46 MB
```

### Standard checks

- `pnpm type-check` — PASS (preflight PB1; no code changed in this lane)
- `pnpm test` — PASS (preflight PB2)
- `pnpm test:db` — PASS against live Supabase, run from this lane worktree 2026-06-11:

```text
$ pnpm test:db
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
```

- `pnpm verify` — via PR CI (binding record)
- `scripts/ci/r-level-check.ts` — via PR CI

### Guardrails

No Redis/Temporal; no ClickHouse approval implied; no data migrated; no P3 certification claims; no CLV/ROI/edge claims.
