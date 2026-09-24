# Historical Market Data Retention and Warehouse Architecture

**Status:** Architecture recommendation — **implemented** under WORK-2026092101 (2026-09-21).
The design below stands as written. It is no longer planning-only: the exporter, manifest,
fail-closed verification, read path and scheduled conveyor now exist in `scripts/warehouse/`,
and the contract that governs them is
[`docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md`](../05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md).
**Still authorizes no data movement and no deletion** — see §11 and the contract's §6.
**Issue:** UTV2-1237 · **Tier:** T2 · **Date:** 2026-06-11
**PM position:** Supabase remains the hot operational DB; historical market data needs a cold-storage/warehouse strategy *before* line volume becomes an operational risk. Not required before Production Readiness Audit v2; not a P3 certification lane; not a product feature lane.

---

## 1. Purpose

Define the hot/cold data boundary, retention windows, export/verification mechanics, and restore/query story for historical market data — so a future implementation lane can execute without re-deriving the design. This doc makes **no CLV / ROI / edge claims** and authorizes **no data movement**.

## 1a. Implementation status (2026-09-21)

| Section | Status | Where it lives |
|---|---|---|
| §4 retention windows | implemented as policy data | `DEFAULT_RETENTION_POLICY` in `scripts/warehouse/conveyor.ts` |
| §5 export pipeline | implemented | `scripts/warehouse/export-partition.ts` |
| §5 object layout | implemented, `LAYOUT_VERSION = 1` | `scripts/warehouse/object-layout.ts` |
| §6 manifest | implemented, `schema_version = 1` | `scripts/warehouse/manifest.ts` |
| §6 verification | implemented, fail-closed | `scripts/warehouse/verify-archive.ts` |
| §5 daily conveyor | implemented | `scripts/warehouse/conveyor.ts`, `.github/workflows/warehouse-archive-conveyor.yml` |
| §7 DuckDB query story | implemented | `scripts/warehouse/query.ts` |
| §5 detach-then-drop | **not implemented, deliberately** | a prune is PM-gated; there is no delete path in this repository |
| Object storage itself | **not provisioned** | owner action — `docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md` |

Two things in this document were measured in 2026-06 and have since been contradicted by current
repo truth. Both are corrected in
[`docs/05_operations/FIRST_ARCHIVE_CANDIDATE_PACKET.md`](../05_operations/FIRST_ARCHIVE_CANDIDATE_PACKET.md) §2:

1. `provider_offers_legacy_quarantine` is described below as having **zero operational reads**. On
   current `main` a view (`public.provider_offers`), a replay/proof view (`sgo_replay_coverage`), a
   live Command Center panel and three operator scripts all read through to it.
2. The retention table's per-sport partitioning is **not** what the default policy does. A
   sport-partitioned policy must enumerate its sports, and any row outside that list would then be
   archived by nothing — so the default writes one object per day per source and leaves sport as a
   column.

**PM decisions of 2026-09-24 supersede the quarantine disposition below.** Wherever §3, §4, §9 or
§10 says `provider_offers_legacy_quarantine` is "export then prune", read instead: it is
**archived, and not pruned** — not even after its archive verifies. Hot retention for
`provider_offer_history` is **45 days**, and no row or partition is prune-eligible without a
written and independently verified archive. Cron job 5 `nightly-retention-prune`, which dropped
history partitions after 7 days and pruned the quarantine, was deactivated by Griff the same day.
How the existing history and the quarantine reach the warehouse:
[`docs/05_operations/WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md`](../05_operations/WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md).

## 2. Current state (measured 2026-06-11, live DB)

| Table | Size | Notes |
|---|---|---|
| `provider_offers_legacy_quarantine` | **6,531 MB** | Quarantined legacy offers; recorded here as having zero operational reads. **That is contradicted by current repo truth — see §1a.** Largest single object in the DB. |
| `system_runs` | **1,131 MB** | Operational run log; unbounded growth (~5-min `candidate.scoring` cadence + every subsystem heartbeat). |
| `provider_offer_current` | 230 MB / ~285k rows | Hot operational; bounded by market churn but growing. |
| `provider_offer_history_pYYYYMMDD` | ~80–220 MB/day at peak | Daily partitions pre-created through 2026-06-30. |
| `pick_promotion_history` | 90 MB | Append-only audit trail. |
| `pick_candidates` | 67 MB / ~43k rows | Hot operational. |
| `audit_log` | 61 MB | Append-only. |
| `raw_payloads` | 46 MB | Already exhibited an insert **statement timeout** (2026-06-10 05:23Z MLB cycle) — first concrete hot-table pressure signal. |

Risk trajectory: at peak-season ingest (~200 MB/day of offer history), offer history alone adds ~6 GB/month. Supabase storage and vacuum/IO pressure, not row counts per se, are the operational risk.

## 3. Hot/cold boundary

**Hot (stays in Supabase):** everything the runtime reads or writes on the request/cycle path —
`provider_offer_current`, `pick_candidates`, `picks`, `pick_lifecycle`, `syndicate_board`, `market_universe`, `settlement_records`, `distribution_outbox`/`distribution_receipts`, `events`/`participants`/reference tables, and the most recent **N days** of `provider_offer_history` (see §4).

**Cold (exported to object storage as Parquet):**
1. `provider_offer_history` partitions older than the hot window — the dominant volume.
2. `provider_offers_legacy_quarantine` — one-time archive, **not pruned** (PM 2026-09-24, §1a). It still has read dependencies (§1a), and PM holds the prune.
3. `raw_payloads` older than the hot window (provider forensics rarely needed past a few weeks).
4. `system_runs` older than retention (or aggregate-then-prune; it is observability, not market data — but it is the #2 object and must not be exempt from retention).

**Never pruned without verified export:** anything feeding settlement, CLV joins, certification evidence, or audit (`settlement_records`, `pick_promotion_history`, `audit_log`, `certification_*` stay hot indefinitely until a separate, PM-approved policy says otherwise — they are small relative to offer history).

## 4. Retention windows (recommendation)

| Data | Hot retention | Cold retention |
|---|---|---|
| `provider_offer_history` partitions | **45 days** (covers CLV joins, recent-form models, monitor lookbacks) | Indefinite (Parquet) |
| `raw_payloads` | 21 days | 1 year (Parquet), then delete |
| `provider_offers_legacy_quarantine` | **Indefinite — PM prune hold (2026-09-24)**; archived once | Indefinite |
| `system_runs` | 90 days | 1 year (Parquet) |
| All settlement / promotion / audit / cert tables | Indefinite hot | n/a (revisit at 1 GB each) |

The 45-day offer-history window is deliberately conservative: the longest current consumer lookback observed is the UTV2-1042 data-gate monitor (post-cutover window, ~30 days max so far). Shrink later, never before consumers are inventoried (§8).

## 5. Export pipeline

- **Format:** Parquet (columnar; DuckDB/ClickHouse/Polars-native), zstd compression.
- **Partitioning:** `dt=YYYY-MM-DD/sport=<sport_key>/` directory layout; one file set per source-table daily partition. Market/book stay as columns (cardinality too high to be useful as paths).
- **Storage target:** S3-compatible object storage. Default recommendation: **Hetzner Object Storage** (same provider as production, no egress between box and bucket, EU locality). Supabase Storage acceptable as interim; AWS S3 if cross-provider durability is wanted.
- **Cadence:** daily job (the day **after** a partition closes), exporting partition `p(D-46)` once it leaves the hot window — i.e., a steady one-partition-per-day conveyor.
- **Mechanics:** read the closed partition (it is immutable by then), write Parquet, upload, verify (§6), then `DROP`/`DETACH` the Supabase partition. Detach-then-drop is preferred: detach is instant and reversible until the drop.
- **Runtime home:** a scheduled job on the Hetzner host (compose one-shot container or systemd timer). **Hard requirement learned from UTV2-1257:** the exporter must have a *managed* runtime home with a `system_runs` heartbeat and staleness alert — never an operator-laptop process.

## 6. Archive manifest (verification before prune)

One manifest JSON per exported partition, stored alongside the Parquet files **and** in a small hot `archive_manifests` table:

```json
{
  "schema_version": 1,
  "source_table": "provider_offer_history_p20260512",
  "partition_key": "2026-05-12",
  "row_count_source": 0,
  "row_count_exported": 0,
  "checksum_sha256": "<file checksum(s)>",
  "byte_size": 0,
  "exported_at": "<ts>",
  "export_sha": "<repo SHA of exporter>",
  "verified_at": "<ts>",
  "verification": {
    "row_count_match": true,
    "checksum_verified": true,
    "sample_readback_rows": 100,
    "sample_readback_match": true
  }
}
```

**Prune gate (fail-closed):** a partition may be dropped only when its manifest exists with `row_count_match && checksum_verified && sample_readback_match`. The prune job re-reads the manifest from the bucket (not from local state) before dropping. No manifest → no prune, alert.

## 7. Restore / query story

- **Ad-hoc analytics & backtesting:** DuckDB directly over the bucket (`read_parquet('s3://…/dt=*/sport=*/*.parquet')`). Zero standing infra; works from any operator machine or CI job. This is the default and is sufficient for current needs.
- **Restore-to-hot:** reverse of export — read Parquet, `CREATE TABLE … PARTITION`, attach. Manifest checksums verify integrity on the way back.
- **Future analytics layer:** ClickHouse only if/when query latency over the bucket becomes a real constraint — **separately approved, not part of this design** (explicitly out of scope per issue).

## 8. Pre-implementation inventory (first task of the implementation lane)

1. Grep/runtime-audit every consumer of `provider_offer_history` and `raw_payloads` with its maximum lookback (scoring, CLV join, monitors, replay scripts — `sgo-r5-*` replay tooling reads history and must be pointed at DuckDB-over-Parquet for windows beyond hot retention).
2. Confirm no FK references into prune candidates.
3. Decide `system_runs` strategy: prune vs. aggregate (daily rollup table) — rollup preferred so ops dashboards keep long trends.

## 9. Risk assessment — continuing Supabase-only short term

Acceptable for roughly the next 60–90 days: current total is dominated by one 6.5 GB dead table; live growth is ~2–6 GB/month seasonal. The observed `raw_payloads` statement timeout shows pressure is real but not yet systemic. The 2026-06 recommendation to **export + prune `provider_offers_legacy_quarantine`** first is superseded: PM decided on 2026-09-24 to archive it and keep it (§1a). A `system_runs` retention job remains a separate proposal.

## 10. Candidate follow-up lanes

1. **T2** — legacy-quarantine one-time archive, **no prune** (PM 2026-09-24; see the backfill plan).
2. **T2** — `system_runs` retention/rollup job.
3. **T2** — daily offer-history Parquet conveyor + `archive_manifests` table + prune gate (the core of this doc).
4. **T3** — replay tooling reads cold storage transparently (DuckDB adapter).

## 11. Guardrails

- No Redis, no Temporal.
- No ClickHouse without separate approval.
- No production data migrated in this lane.
- Nothing in this design creates or implies CLV / ROI / edge claims.
- Prune is always fail-closed behind a verified manifest.

## Cross-references

- `docs/06_status/CURRENT_STATE.md` — program state
- `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` — provider/SGO data semantics
- `docs/02_architecture/PICK_LIFECYCLE_AND_EVIDENCE_MODES.md` — evidence-plane doctrine (exported history must remain sufficient to re-derive evidence joins)
- `docs/05_operations/contracts/backup-policy-v1.md` — backup vs. archive distinction (backups are for disaster recovery; this design is for retention/analytics and does not replace WAL/PITR)
