# UTV2-862: Provider-History Migration Slice Audit

**Date:** 2026-05-09  
**Executor:** Claude (UTV2-862)  
**Tier:** T1  
**Parent:** UTV2-855 (System Wire)  
**Related:** UTV2-772 (provider_offer_history partitioning and retention)

---

## Executive Summary

All 5 UTV2-772 migration files are **applied live** but **absent from the remote migration ledger**. Schema artifacts are complete and operational, but the new write path (`merge_provider_offer_staging_cycle`) has never been activated. The legacy `provider_offers` table remains the active write path with 8.29M rows. Two cron calls mandated by the migrations are missing from the live cron body. No historical data has been lost.

**Recommendation: safe to align ledger. Do not activate write path until cron fix is applied.**

---

## 1. Migration Slice — State Matrix

| Migration | In Ledger | Objects Live | Data Active | Risk |
|-----------|-----------|--------------|-------------|------|
| `202604291001` — bounded_provider_offers_retention | ❌ | ✅ function | ✅ cron active | Medium |
| `202604291002` — provider_offer_history_partitioning | ❌ | ✅ table + 16 partitions | ❌ 0 rows | Medium |
| `202604291003` — provider_offer_current_table_cutover | ❌ | ✅ table + RPCs | ❌ merge RPC dormant | High |
| `202605030001` — provider_offer_history_partition_retention | ❌ | ✅ function | ❌ cron not calling it | Medium |
| `202605030002` — provider_offer_line_snapshots | ❌ | ✅ table + function | ❌ 0 rows | Medium |

---

## 2. Live Data State (confirmed 2026-05-09)

| Table | Rows | State |
|-------|------|-------|
| `provider_offers` | 8,291,206 | Active write path — legacy table |
| `provider_offer_current` | 167,498 | Active, seeded from provider_offers |
| `provider_offer_history` | 0 | Structure complete; write path not activated |
| `provider_offer_line_snapshots` | 0 | Downstream of empty history |

**Live partitions:** 16 daily partitions from `p20260429` → `p20260514`. All empty.

**All 8 functions present live:**
- `prune_provider_offers_bounded` ✅
- `ensure_provider_offer_history_partition` ✅
- `ensure_provider_offer_history_partitions` ✅
- `drop_provider_offer_history_partitions_before` ✅ (deprecated, superseded by below)
- `drop_old_provider_offer_history_partitions` ✅
- `merge_provider_offer_staging_cycle` ✅ (dormant)
- `list_provider_offer_current_opening` ✅
- `summarize_provider_offer_history_partition` ✅

---

## 3. Cron Gap — Highest Operational Risk

Live cron `nightly-retention-prune` (runs `0 3 * * *`):

| Call | Expected | Actual |
|------|----------|--------|
| `prune_provider_offers_bounded(7, 5000, 20)` | ✅ | ✅ active |
| `summarize_provider_offer_history_partition(cutoff_day)` | ✅ (from 202605030002) | ❌ MISSING |
| `drop_old_provider_offer_history_partitions(7)` | ✅ (from 202605030001) | ❌ MISSING |
| `provider_offer_line_snapshots` prune at 180 days | ✅ (from 202605030002) | ✅ active |

**Consequence:** Migration 202605030002 was intended to reschedule the cron with all four calls. The snapshot-prune line was applied but the summarize and partition-drop lines were not. The live cron body is a partial application of migration 202605030002.

**Impact now:** Benign — partitions are empty so no data would be lost if manually dropped.  
**Impact after write-path activation:** Critical — partition drop without prior summarization permanently destroys line-movement data.

---

## 4. Ghost Migration

`202604300003` appears in the remote ledger as the most recent applied migration but has **no corresponding local file**. It was applied directly to Supabase (dashboard or CLI outside repo) without being committed to source control.

This ghost entry is why the 5 UTV2-772 local files fall after the ledger boundary despite their objects being live. Recovery options:
- Retrieve the DDL via `pg_dump --schema-only` and backfill the file, or
- Explicitly acknowledge it as an unrecoverable out-of-band apply and document the exception

---

## 5. Additional Ledger Divergence (D3 scope, not UTV2-772)

Local migration files also absent from ledger (noted, not audited here):

| Migration | Issue | Objects live? |
|-----------|-------|---------------|
| `202605020001` | UTV2-725 pick_candidates_sport_key | Needs verification |
| `202605020002` | UTV2-725 backfill_pick_candidates_pick_id | Needs verification |
| `202605070001` | UTV2-845 stake_units_integrity_guard | Needs verification |
| `202605070002` | UTV2-854 model_ownership_persistence | Needs verification |

These are in scope for UTV2-860 (D3 live schema reconciliation), not this lane.

---

## 6. Risk Classification

**202604291001 (bounded_retention):** Medium.  
Function-only migration. No schema changes. Cron body calling it correctly. Ledger alignment is the only outstanding action. No apply risk.

**202604291002 (history_partitioning):** Medium.  
Creates `provider_offer_history` partitioned table. Table and 16 partitions confirmed live. No data flowing yet. Partitioned table schema is stable. Ledger alignment safe. No apply risk.

**202604291003 (current_table_cutover):** High.  
Promotes `provider_offer_current` from view to writer-maintained table. Defines `merge_provider_offer_staging_cycle` RPC — this is the write-path switchover RPC. Table is live and seeded. The RPC is dormant (never called by ingestor). The cutover is an **operational decision** — activating it requires sequencing with ingestor changes and must not happen before the cron fix. Ledger alignment is safe independently.

**202605030001 (partition_retention):** Medium.  
Defines `drop_old_provider_offer_history_partitions`. Function exists live. Cron is not calling it. No immediate risk because partitions are empty. Ledger alignment safe. Cron fix required before write path activation.

**202605030002 (line_snapshots):** Medium.  
Creates `provider_offer_line_snapshots` table and `summarize_provider_offer_history_partition` function. Table empty. Cron has the snapshot-prune line but is missing the summarize and partition-drop calls. Ledger alignment safe. Cron fix required before write path activation.

---

## 7. Historical Integrity Assessment

**No historical data loss has occurred.** Reasoning:

- `provider_offers` (8.29M rows) is intact and continues to be the live data store
- `provider_offer_history` is empty — no data was ever written to it, so no data can be missing from it
- `provider_offer_line_snapshots` is empty — same reasoning
- `provider_offer_current` (167K rows) reflects current live offer state, correctly seeded

The prune on `provider_offers` (`p_batch_size=5000, p_max_batches=20` = max 100K rows/night) is running but the table has accumulated 8.29M rows. At that prune rate with any ongoing writes, drain is slow. This is a throughput gap, not a data integrity issue.

---

## 8. Recommendations

### R1 — Ledger Alignment (safe, no DDL)
Insert the 5 UTV2-772 version records into `supabase_migrations.schema_migrations`. All objects are already live; no DDL is needed. This resolves the ledger divergence for this slice.

```sql
-- Execute as a new migration or via operator-direct ledger insert:
INSERT INTO supabase_migrations.schema_migrations (version) VALUES
  ('202604291001'),
  ('202604291002'),
  ('202604291003'),
  ('202605030001'),
  ('202605030002')
ON CONFLICT DO NOTHING;
```

**Gate:** Confirm ghost migration `202604300003` is acknowledged or recovered before ledger alignment so the sequence is contiguous.

### R2 — Cron Fix Migration (required before write path activation)
A new migration must update `nightly-retention-prune` to add the missing calls in correct order:

```sql
-- Pseudocode for new migration 202605090001_utv2_862_cron_fix_partition_lifecycle.sql
SELECT cron.unschedule('nightly-retention-prune');
SELECT cron.schedule('nightly-retention-prune', '0 3 * * *', $$
  -- 1. Summarize the partition about to be dropped before pruning
  SELECT * FROM public.summarize_provider_offer_history_partition(
    (timezone('utc', now()) - INTERVAL '8 days')::date
  );
  -- 2. Drop partitions older than 7 days
  SELECT * FROM public.drop_old_provider_offer_history_partitions(7);
  -- 3. Existing retention calls
  SELECT * FROM public.prune_provider_offers_bounded(7, 5000, 20);
  DELETE FROM public.audit_log WHERE created_at < NOW() - INTERVAL '90 days';
  DELETE FROM public.alert_detections WHERE created_at < NOW() - INTERVAL '30 days';
  DELETE FROM public.submission_events WHERE created_at < NOW() - INTERVAL '90 days';
  DELETE FROM public.distribution_outbox WHERE status = 'delivered' AND updated_at < NOW() - INTERVAL '7 days';
  DELETE FROM public.distribution_receipts WHERE created_at < NOW() - INTERVAL '7 days';
  DELETE FROM public.provider_offer_line_snapshots WHERE snapshot_date < (timezone('utc', now()) - INTERVAL '180 days')::date;
$$);
```

### R3 — Write Path Activation (operator decision, deferred)
Do not call `merge_provider_offer_staging_cycle` from the ingestor until:
1. Cron fix (R2) is applied and confirmed
2. At least 1 nightly cron cycle has run with the corrected body
3. Operator has reviewed the partition-drop + summarize sequencing
4. A baseline partition is confirmed populated via a test run

### R4 — Ghost Migration Recovery
Retrieve `202604300003` DDL from live DB and commit a local file, or document it as an accepted out-of-band exception in `DB_MIGRATION_WORKFLOW.md`. This is a D3 governance gap, not a UTV2-772 gap.

### R5 — provider_offers Prune Throughput
With 8.29M rows and 100K/night max batch, the drain timeline is long. After write path activation (R3), recommend a one-time operator-supervised prune run with higher batch parameters, or setting a planned drain schedule.

---

## 9. Exit Criteria Verification

| Criterion | Status |
|-----------|--------|
| Migration slice fully understood | ✅ All 5 migrations audited; objects confirmed live |
| Risk documented | ✅ Risk classification assigned to all 5 |
| Apply/no-apply recommendation explicit | ✅ Ledger alignment: safe. Write path: deferred. Cron fix: required first. |
| Operational safety validated | ✅ No data loss. Cron gap identified and forward-fix specified. |

---

## 10. PM Decisions (2026-05-09)

### PR #607 — APPROVED + MERGED
Merge SHA: `592bd869532e5624714803f22eafb9c4ef505b79`

PM rationale: additive operational fix, low-risk cron correction, governance-approved, closes a verified live operational gap, no destructive mutation risk, preserves historical integrity.

### PM-Approved Apply Sequence (formal execution path)

1. Merge PR #607 ✅ done
2. Apply migration `202605090001` to live Supabase
3. Wait one successful nightly cron cycle
4. Verify summarize → drop ordering executed correctly in cron logs
5. **Only then** enable `merge_provider_offer_staging_cycle` in the ingestor

### Ghost Migration `202604300003` — PM Guidance

**Classification:** Historical migration integrity uncertainty — not a nuisance.

**Prohibited actions:**
- Migration repair
- Ledger deletion
- Fake reconciliation

**Required approach:** Operator governance decision involving:
- Determine origin of the apply
- Determine whether it represented a real schema change
- Determine whether the local file was lost or never committed
- Determine whether forward-fix ledger reconciliation is required

**Tracking:** New issue created (see UTV2-866 or successor) for ghost migration investigation.

---

## 11. Unblocks

Completing this audit unblocks:
- **UTV2-860** (Reconcile D3 live schema gap) — can now proceed with full D3 ledger alignment
- **UTV2-863** (Apply model ownership schema live) — depends on UTV2-860 completion
