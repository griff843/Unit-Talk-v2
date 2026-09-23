# First Archive Candidate — `provider_offers_legacy_quarantine`

**Status:** NOT READY TO RECOMMEND. Blocking unknowns remain.
**Lane:** WORK-2026092101 · **Tier:** T2
**Nothing in this lane deleted, dropped, pruned or modified any production row.**

This packet exists to prepare a decision, not to make one. It is written against **current repo
truth**; the production database was `RESTORING` throughout this lane, so every live measurement
below is marked **UNMEASURED** with the exact command that closes it.

---

## 1. The historical claim, and why it is not evidence

A 2026-07-07 measurement recorded ~6.5 GB, ~8.19M rows, frozen/legacy posture, and **no
operational reads**. `HISTORICAL_MARKET_DATA_WAREHOUSE.md` §3 independently recorded 6,531 MB on
2026-06-11 and named it the largest object in the database with zero operational reads.

Those are historical facts about a database that has since been restored. They establish that this
relation is *worth assessing*. They establish nothing about today.

## 2. Current repo truth — and it contradicts "no operational reads"

Measured against `origin/main` in this lane. This is the finding that matters most in this packet.

| Dependent | Evidence | Kind |
|---|---|---|
| **View `public.provider_offers`** | `supabase/migrations/00000000000000_baseline_live_schema.sql:3406` — `SELECT … FROM public.provider_offers_legacy_quarantine` | a *view* named like a live table routes straight to the quarantine |
| **View `public.sgo_replay_coverage`** | same file, `:3512` and `:3516` — two `LEFT JOIN LATERAL`s against `provider_offers_legacy_quarantine` for opening and closing lines | **a proof/replay path**, which is exactly the dependency class the packet asked to rule out |
| **Function `prune_provider_offers_quarantine`** | same file, `:1491`–`:1508` — a batched `DELETE FROM public.provider_offers_legacy_quarantine` | a *destructive* path already exists in the database and is not governed by this contract |
| **Command Center storage health** | `apps/command-center/src/lib/data/storage-health.ts:78,197,219` — `select … from provider_offers where created_at >= now() - interval '1 day'` | a **live operator surface** reads the view, therefore the quarantine |
| **Closing-line backfill** | `apps/api/src/scripts/backfill-closing-lines.ts:34,45,85,118` | operator script |
| **UTV2-727 replay-coverage proof** | `apps/api/src/scripts/utv2-727-replay-coverage-proof.ts:69` | proof script |
| **Provider snapshot script** | `scripts/utv2-252-provider-snapshot.ts:50` | operator script |
| **Ingestor write surface** | `apps/ingestor/src/write-surface.ts:17-22` maps four provider-offer writes to the logical name `provider_offers` | a write path aimed at a name that currently resolves to the quarantine |
| **Indexes** | ~8 indexes on the relation, including two BRIN and several partial-on-`is_closing` (`:4744`–`:5227`) | indexes that specific, tuned queries were built for |

**Conclusion of §2: the historical "no operational reads" posture does not hold on current `main`.**
At minimum a live operator surface and a replay/proof view read through to this relation. That does
not make it un-archivable — it makes "archive then prune" a different and larger decision than the
2026-07 note implied, because a prune would break `sgo_replay_coverage` and empty a panel in the
Command Center.

The **archive** half is unaffected by all of this: exporting the relation to Parquet is
non-destructive and can proceed the moment production is queryable and a bucket exists.

## 3. Live reverification — measured 2026-09-23

Read-only against production `zfzdnfwdarxucxtaojxm` after the restore. Statistics counters reset at
the 2026-09-23 01:46:41Z postmaster restart, so #6 covers about three hours.

| # | Question | Measured |
|---|---|---|
| 1 | Does the relation still exist? | **Yes** |
| 2 | Size | **6,531 MB** — heap 2,433 MB, indexes 4,097 MB |
| 3 | Row count | ≈ **8.19 M** (`reltuples`; not load-bearing, so no exact count) |
| 4 | Inbound foreign keys | **None** |
| 5 | Oldest / newest `snapshot_at` | **2026-04-23 → 2026-04-29** |
| 6 | Does anything execute against it? | **Yes.** Since restart: `seq_scan` 1,664, `idx_scan` 100,085, `n_tup_del` 100,000 — the last is pg_cron job 5 at 03:00Z, rolled back (see §3a) |
| 7 | Is `provider_offers` auto-updatable? | **Yes — `is_updatable = YES`, `is_insertable_into = YES`.** It is a plain `SELECT *` over the quarantine with no triggers. A reactivated ingestor writing to `provider_offers` writes into the quarantine. `SGO_REACTIVATION_GATE.md` must treat this as open |
| 8 | Is a prune scheduled? | **Yes** — job 5 `nightly-retention-prune` calls `prune_provider_offers_bounded(7, 5000, 20)` nightly |
| 9 | Does a proof/replay path read `sgo_replay_coverage`? | **Yes** — it depends on the quarantine, `market_universe` and `pick_candidates`, and is read by `apps/api/src/scripts/utv2-727-replay-coverage-proof.ts` |

### 3a. Job 5 has never succeeded

All 136 recorded runs of job 5 (2026-05-10 → 2026-09-23) failed on `audit_log is immutable` and
rolled back, so the quarantine has never actually been pruned. That protection is accidental. The
recommendation to Griff is to **deactivate job 5** before anything changes the `audit_log` trigger;
it is a production change and is reserved. Full statement in
`PRODUCTION_DB_SIZING_AUDIT.md` §6.

## 4. What a recommendation would have to contain, and does not yet

1. Answers to all nine of §3, measured not recalled.
2. A disposition for `sgo_replay_coverage` — it either loses its source or is repointed at the archive.
3. A disposition for the `provider_offers` view and its Command Center reader.
4. Confirmation from §3 #7 that a reactivated ingestor does **not** write here.
5. A verified archive of the full relation: every window exported, verified and manifested under
   §6 of `WAREHOUSE_ARCHIVE_CONTRACT.md`.
6. Griff's authorization. Production data deletion is reserved decision 1 in `docs/mission/intent.md`.

`assessArchiveCandidate` has **no `candidate` verdict** by construction. Catalog state can show a
relation is large, old and unreferenced; it cannot show that nothing reads it. Promotion to a prune
candidate is a human step taken with §3 in hand.

## 5. Recommendation as of this lane

**Archive it; do not schedule it for prune.** Re-affirmed 2026-09-23 with §3 measured: #6, #7, #8
and #9 each independently rule out a prune.

The export is non-destructive, bounded, verified, and would immediately give the archive a real
multi-gigabyte body to prove the read path against. It changes nothing in production.

The prune is a separate decision that §2 has made materially larger than it looked, and it does not
become available merely because the archive verifies.
