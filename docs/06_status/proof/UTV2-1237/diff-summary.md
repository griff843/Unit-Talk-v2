# UTV2-1237 — Diff Summary

## Scope

Architecture planning lane (docs-only, governance). One new document:

- `docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md`

No runtime code, no migrations, no infra changes, no data movement.

## Content

Hot/cold data boundary, retention windows (45d offer history / 21d raw payloads / 90d system_runs), Parquet-on-object-storage export conveyor with fail-closed archive-manifest prune gate, DuckDB-over-bucket restore/query story, consumer-inventory prerequisites, risk assessment for staying Supabase-only short term, and four bounded candidate follow-up implementation lanes.

Grounded in live measurements (2026-06-11): `provider_offers_legacy_quarantine` 6.5 GB (dead weight), `system_runs` 1.1 GB, offer-history partitions 80–220 MB/day, plus the observed `raw_payloads` statement timeout on the 2026-06-10 05:23Z MLB cycle.

## Guardrails honored

No Redis/Temporal; ClickHouse explicitly deferred to separate approval; no P3 certification implications; no CLV/ROI/edge claims.

## Merge binding

Merge SHA: 905a51340e8d5715dc9fbcc682eb2509b799554a (PR #1010)
