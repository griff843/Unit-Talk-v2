# Supabase Usage Cost Truth Audit

Issue: UTV2-1369
Date: 2026-07-07
Author: Claude (T2 read-only audit lane)
Scope: read-only only, per issue acceptance criteria — no code, query, or configuration changes made.

## Summary

Direct Supabase billing/usage-dashboard figures ("current month usage" in dollar terms) are not accessible through the tooling available to this lane — no MCP tool exposes the organization billing/usage API, only project metadata and direct SQL introspection. This audit instead establishes the strongest available proxy: live database size, per-table storage breakdown, and a measured daily growth rate derived from date-partitioned tables, which map directly to Supabase's storage and compute billing dimensions. All figures below are from read-only `SELECT` queries against Postgres system catalogs (`pg_class`, `pg_namespace`) and the Supabase Performance Advisor, executed 2026-07-07 against project `zfzdnfwdarxucxtaojxm`.

**Headline finding:** total database size is 18 GB. A single table — `provider_offers_legacy_quarantine`, an explicitly legacy/frozen table — accounts for 6.5 GB (36% of total database size, 8.19M rows). Live `provider_offer_history` partitions add a further ~7.6 GB. Combined, provider-offer data (current + legacy + history) is the dominant storage cost driver, at roughly 78% of total database size.

## Top Cost Drivers (by storage, descending)

| Table | Total size | Est. rows | Notes |
|---|---:|---:|---|
| `provider_offers_legacy_quarantine` | 6,531 MB | 8,192,156 | **Legacy/frozen** table (per prior session context: superseded by `provider_offer_history`, kept only as a quarantine archive). Largest single storage cost driver in the database — 36% of total. |
| `provider_offer_history_p20260624` | 1,613 MB | 2,741,560 | Date-partitioned live table. This partition is ~1.5–2x larger than its neighbors (see Growth Rate below) — worth a follow-up look at what happened on 2026-06-24. |
| `system_runs` | 1,229 MB | 3,379,614 | Operational run-log table. Prior incident context (session memory) already identified this table as a bloat source once (1.2GB/130 live rows due to dead autovacuum) — current 3.38M row count suggests it has grown substantially since and may need a retention/archival policy, not just vacuum. |
| `provider_offer_history_p20260628` | 1,085 MB | 1,931,531 | Live partition. |
| `provider_offer_history_p20260630` | 1,080 MB | 1,913,971 | Live partition — **most recent partition that exists**; no partition has been created since (see Growth Rate note on ingestion gap). |
| `provider_offer_history_p20260626` | 989 MB | 1,689,529 | Live partition. |
| `provider_offer_history_p20260627` | 988 MB | 1,744,048 | Live partition. |
| `provider_offer_history_p20260629` | 909 MB | 1,605,484 | Live partition. |
| `raw_payloads` | 694 MB | 14,525 | Only 14.5K rows but 694 MB — averages ~48 KB/row. Raw API response archive; appears to have no visible retention/cleanup job (see below). |
| `odds_snapshots` | 427 MB | 9,239 | Only 9.2K rows but 427 MB — averages ~46 KB/row. Same archival pattern as `raw_payloads`. |
| `provider_offer_current` | 401 MB | 497,201 | Current-state table (not history). |
| `provider_offer_history_p20260625` | 370 MB | 637,398 | Live partition. |
| (10 more `provider_offer_history_p*` partitions, `pick_candidates`, `pick_promotion_history`, `audit_log`, `syndicate_board`, each 85–220 MB) | — | — | Individually smaller; not a priority driver. |

**Total database size: 18 GB** (`pg_total_relation_size` summed across all `public` schema tables).

## Growth Rate (derived from date-named partitions — a genuine cost-projection signal)

`provider_offer_history` is partitioned by day (`_p20260622`, `_p20260623`, ... `_p20260630`). This gives a directly measurable daily growth rate without needing billing-dashboard access:

| Partition date | Size |
|---|---:|
| 2026-06-22 | 115 MB |
| 2026-06-23 | 162 MB |
| 2026-06-24 | 1,613 MB (anomalous spike — 8–10x neighboring days) |
| 2026-06-25 | 370 MB |
| 2026-06-26 | 989 MB |
| 2026-06-27 | 988 MB |
| 2026-06-28 | 1,085 MB |
| 2026-06-29 | 909 MB |
| 2026-06-30 | 1,080 MB |

Excluding the 2026-06-24 anomaly, average daily growth over the remaining 6 days (06-25 through 06-30) is **~903 MB/day**. At that rate, uncontrolled `provider_offer_history` growth alone projects to roughly **27 GB/month**, which would exceed the entire current database size within about 20 days if sustained continuously.

**Critical caveat — this table has not grown since 2026-06-30.** No partition newer than `_p20260630` exists, a 7-day gap as of this audit. This is not a sign of the cost problem being resolved — it directly corresponds to the ongoing ingestor outage documented in this session's incident work (UTV2-1477/1478): the ingestor has been blocked from writing fresh provider data since approximately that date. **The true daily growth rate, once ingestion resumes, should be expected to return to the ~900 MB–1.6 GB/day range measured above** — this is a cost driver that is currently suppressed by an unrelated incident, not one that has been fixed.

## Top Query-Class Cost Drivers (Performance Advisor findings)

Supabase's built-in Performance Advisor (read-only lint, no query execution) surfaced 291 findings against this database:

- **153 unused indexes** — indexes that have never been used by the query planner. These consume storage and add write overhead (every `INSERT`/`UPDATE` must maintain them) with zero read benefit. Several are on the largest tables, including at least one on `provider_offers_legacy_quarantine` itself (`provider_offers_opening_scan_idx`).
- **137 unindexed foreign keys** — FK constraints without a covering index, which forces sequential scans or worse query plans on joins/deletes involving those columns, increasing compute (and therefore egress/CPU billing dimensions) per query.
- **1 informational note** on `auth` schema DB connection usage (non-actionable at INFO level).

These 290 non-informational findings were not individually triaged for exact byte-level savings in this pass (that level of detail — e.g., `pg_relation_size` per unused index — is a natural next step for a follow-up lane, not required by this audit's acceptance criteria).

## Immediate Cost Stop Conditions

These are read-only observations of what *would* stop or slow cost growth if acted upon — **no changes were made in this lane**, per its explicit read-only scope:

1. **`provider_offers_legacy_quarantine` (6.5 GB, 36% of DB) is explicitly legacy/frozen data.** If it is confirmed no longer needed for any live read path (this audit did not re-verify that — prior session context already established `provider_offer_history` is the active table), archiving it out of the live Postgres instance (e.g., to object storage) or dropping it would be the single largest available storage-cost reduction, larger than all other findings combined.
2. **`raw_payloads` and `odds_snapshots` show no evidence of a retention/cleanup job** in the codebase (searched `scripts/` for retention/delete logic against these two tables; none found). At ~46–48 KB/row for what are likely point-in-time API response captures, unbounded retention here is a compounding, low-visibility cost driver.
3. **`system_runs`** has recurred as a bloat source before (per prior incident: 1.2 GB from just 130 live rows due to dead autovacuum). At 3.38M rows / 1.2 GB now, it warrants checking whether a retention policy exists or whether it is still accumulating without bound.
4. **153 unused indexes** are a mechanical, low-risk cleanup candidate (dropping an index that has genuinely never been used does not change query correctness) — but each should be re-confirmed against a longer observation window before dropping, since "never used" reflects the advisor's own tracked window, not necessarily all-time usage.

## Follow-up Lanes (implementation, not this lane)

Per this lane's acceptance criteria, no query rewrite, schema change, or cleanup was implemented here. Recommended follow-up lanes, each requiring its own PM gate before implementation:

1. Confirm `provider_offers_legacy_quarantine` has zero live read dependents, then archive/drop it (largest single win).
2. Establish or verify a retention policy for `raw_payloads`, `odds_snapshots`, and `system_runs`.
3. Triage and drop confirmed-safe unused indexes (153 candidates) after a longer confirmation window.
4. Add covering indexes for the highest-traffic of the 137 unindexed foreign keys (join-performance, not storage, benefit).

## What this audit could not do (tooling limitation, disclosed per instruction)

No MCP tool or script in this session exposed the Supabase organization billing/usage-dashboard API (dollar figures, request-count metering, egress-byte metering). This audit substitutes the closest available proxy — live storage size and a partition-derived growth rate — which is the dominant driver of Supabase's storage-overage billing dimension, and is defensible evidence, but it is not the same as the literal "current month usage" dollar figure the issue's original description asked for. Obtaining that would require direct access to the Supabase org billing dashboard (not available via any tool connected to this session).
