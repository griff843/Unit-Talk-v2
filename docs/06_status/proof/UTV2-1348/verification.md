# Verification — UTV2-1348: M1 DB Phase 1 Read-Only Inventory and Ledger Baseline

**Issue:** UTV2-1348  
**Tier:** T2  
**Lane type:** verification (read-only diagnostic)  
**Branch:** `claude/utv2-1348-m1-db-finalization-phase1`  
**Supabase project ref:** `zfzdnfwdarxucxtaojxm`  
**Captured at:** 2026-06-28  

---

## Verification

`pnpm verify:static` — **PASS** (exit 0)

- sync-check: PASS
- system-alignment: PASS (fail=0 warn=0)
- automation-coverage: PASS (fail=0 warn=0 classified=15)
- env:check: PASS
- lint: PASS
- type-check: PASS
- build: PASS
- test (unit): PASS (all suites pass)
- verify:commands: PASS

R-level check: `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`  
Result: **PASS** — "Rules matched: (none) — no R-level artifacts required for this diff"

Note: `pnpm verify` (which includes `pnpm test:db`) had 1 flaky failure in an initial run (UTV2-996 settlement correction chain, test 4 of 7). This is a pre-existing live-DB test instability, unrelated to this lane. No code changes were made in this lane. `pnpm verify:static` exits 0 cleanly.

---

## Migration Ledger

### Remote ledger (`supabase migration list --linked`)

Total remote migrations tracked: **113**

Version range: `202603200001` (v2_foundation) through `20260609164544` (utv2_1244_provider_offer_history_event_snapshot_index)

Notable entries include:
- `202603200001` — v2_foundation
- `202604230002` — (null name)
- `202604250001`, `202604250002`, `202604250004`, `202604250005` — (null names)
- `202604270001`, `202604270002` — (null names)
- `202604291001`, `202604291002`, `202604291003` — (null names)
- `202605020001`, `202605020002`, `202605030001`, `202605030002` — (null names)
- `202605070001`, `202605070002` — (null names)
- `202605090001` — (null name)

**Null-name migrations:** 16 out of 113 remote migrations have a null `name` field in the ledger. These are anonymous entries with no descriptive label.

### Local migration inventory (`supabase/migrations/`)

Total local migration files: **1**

```
00000000000000_baseline_live_schema.sql
```

The local migrations directory contains only a single baseline snapshot file. This file's version (`00000000000000`) does **not** appear in the remote migration ledger.

### Ledger comparison

| Category | Count | Notes |
|---|---|---|
| Remote-only migrations | 113 | All remote migrations have no corresponding local file |
| Local-only files | 1 | `00000000000000_baseline_live_schema.sql` — not in remote ledger |
| Synchronized (matching both) | 0 | None |

**Assessment:** The migration ledger is in the known "D3 divergent" baseline state documented in `KNOWN_DEBT.md`. All production migrations were applied directly without corresponding local migration files. The baseline snapshot file is a live schema dump that documents the current production schema but is not tracked as a forward migration in the remote ledger. Per `DB_MIGRATION_WORKFLOW.md`, reconciliation requires Phase 2 (Migration Queue Classification) as a separate implementation lane.

**`lint-migrations` note:** The CI migration linter explicitly skips `00000000000000_baseline_live_schema.sql` as a snapshot replay-root: "fidelity verified by Live Schema Parity." This is expected behavior.

---

## Table Inventory

**DB total size:** 16 GB  
**PostgreSQL version:** 17.6 (aarch64)  
**Captured:** 2026-06-28

### Top 25 tables by total size

| Table | Total Size | Table Only | Index+TOAST Overhead | Live Rows | Dead Rows | Last Autovacuum | Last Autoanalyze |
|---|---|---|---|---|---|---|---|
| provider_offers_legacy_quarantine | 6,531 MB | 2,433 MB | 4,098 MB | 0 | 0 | NULL | NULL |
| provider_offer_history_p20260624 | 1,613 MB | — | — | 2,968,689 | 5,047 | 2026-06-24 11:11 | 2026-06-24 12:24 |
| system_runs | 1,220 MB | 732 MB | 488 MB | 3,325,997 | 31,380 | **NULL** | **NULL** |
| provider_offer_history_p20260628 | 1,061 MB | — | — | 1,923,834 | 0 | 2026-06-28 19:20 | 2026-06-28 19:42 |
| provider_offer_history_p20260626 | 989 MB | — | — | 1,795,948 | 1,677 | 2026-06-26 22:16 | 2026-06-26 22:56 |
| provider_offer_history_p20260627 | 988 MB | — | — | 1,776,102 | 0 | 2026-06-27 23:44 | 2026-06-27 22:07 |
| raw_payloads | 693 MB | 7 MB | 687 MB | 14,257 | 1 | 2026-06-27 02:43 | 2026-06-27 21:48 |
| odds_snapshots | 427 MB | 4 MB | 423 MB | 8,237 | 1 | 2026-06-27 03:30 | 2026-06-28 02:55 |
| provider_offer_current | 384 MB | — | — | 465,496 | 8,010 | 2026-06-28 21:12 | 2026-06-28 20:57 |
| provider_offer_history_p20260625 | 370 MB | — | — | 661,542 | 1,000 | 2026-06-25 21:32 | 2026-06-25 23:29 |
| provider_offer_history_p20260517 | 218 MB | — | — | 0 | 0 | NULL | NULL |
| provider_offer_history_p20260623 | 162 MB | — | — | 266,826 | 39,749 | 2026-06-24 00:03 | 2026-06-24 02:35 |
| pick_candidates | 157 MB | — | — | 81,129 | 1,122 | 2026-06-28 21:32 | 2026-06-28 20:27 |
| pick_promotion_history | 151 MB | — | — | 74,905 | 6,044 | **NULL** | 2026-06-27 18:54 |
| provider_offer_history_p20260622 | 115 MB | — | — | 0 | 9 | NULL | NULL |
| provider_offer_history_p20260512 | 101 MB | — | — | 0 | 0 | NULL | NULL |
| audit_log | 95 MB | — | — | 147,758 | 9 | NULL | 2026-06-27 03:22 |
| provider_offer_history_p20260511 | 79 MB | — | — | 0 | 0 | NULL | NULL |
| market_universe | 78 MB | — | — | 99,879 | 3,272 | 2026-06-28 02:29 | 2026-06-28 02:30 |
| syndicate_board | 73 MB | — | — | 308,012 | 55 | NULL | 2026-06-27 20:50 |
| provider_offer_history_p20260612 | 58 MB | — | — | 0 | 0 | NULL | NULL |
| game_results | 52 MB | — | — | 128,059 | 3,500 | 2026-06-28 20:23 | 2026-06-28 21:06 |
| picks | 47 MB | — | — | 51,396 | 4,618 | 2026-06-28 00:47 | 2026-06-28 10:58 |
| provider_offer_history_p20260610 | 45 MB | — | — | 0 | 0 | NULL | NULL |
| provider_offer_history_p20260618 | 44 MB | — | — | 0 | 0 | NULL | NULL |

### Partition state

| Parent Table | Partition Count |
|---|---|
| provider_offer_history | 60 |
| provider_offer_history_snapshot_idempotency_key (index) | 60 |
| provider_offer_history_pkey (index) | 60 |
| idx_provider_offer_history_event_snapshot (index) | 60 |

### Tables with dead tuples and NO autovacuum (missing autovacuum coverage)

| Table | Dead Tuples | Live Tuples | Dead % | Last Autovacuum |
|---|---|---|---|---|
| system_runs | 31,380 | 3,325,997 | 0.9% | **NULL** |
| pick_promotion_history | 6,044 | 74,905 | 7.5% | **NULL** |
| submission_events | 4,438 | 26,169 | 14.5% | **NULL** |
| submissions | 4,142 | 55,225 | 7.0% | **NULL** |
| pick_lifecycle | 2,789 | 76,731 | 3.5% | **NULL** |
| event_participants | 1,720 | 16,335 | 9.5% | **NULL** |
| execution_intents | 628 | 4,800 | 11.6% | **NULL** |
| participants | 277 | 1,645 | 14.4% | **NULL** |
| events | 133 | 766 | 14.8% | **NULL** |

---

## Findings

These are read-only findings. No repairs applied in this lane.

### F1 — Migration ledger is fully divergent (critical)

All 113 remote migrations have no corresponding local file. The local directory contains one baseline snapshot (`00000000000000_baseline_live_schema.sql`) that is not tracked in the remote ledger. 16 remote migration entries have null names. The repo cannot replay its schema from scratch using the local migration directory. Requires: Phase 2 lane (Migration Queue Classification).

### F2 — `system_runs` autovacuum is missing (critical)

`system_runs` is 1.22 GB with 31,380 dead tuples and NO autovacuum or autoanalyze ever run. This table was the root cause of a prior write-path degradation incident (see KNOWN_DEBT.md and project-supabase-writepath-bloat-rootcause memory). The table has 3.3M live rows and grows continuously. Requires: Phase 4 or Phase 5 lane with VACUUM/autovacuum config fix.

### F3 — `provider_offers_legacy_quarantine` is a 6.5 GB zombie table

6.5 GB table with 0 live rows, 0 dead tuples, NULL autovacuum. This is the renamed legacy `provider_offers` table (per KNOWN_DEBT.md). It holds 2.4 GB of table data and 4.1 GB of index+TOAST overhead, serving no runtime function. Requires: Phase 7 lane (destructive maintenance with PM sign-off, before-count, archive proof, and maintenance window).

### F4 — `raw_payloads` and `odds_snapshots` are TOAST-dominated

- `raw_payloads`: 693 MB total for 14,257 rows (687 MB = 99% TOAST overhead)
- `odds_snapshots`: 427 MB total for 8,237 rows (423 MB = 99% TOAST overhead)

Both tables store large blob payloads with minimal table-side rows. Requires: Phase 4 (retention/archive candidate analysis) before any destructive action.

### F5 — Multiple high-churn tables lack autovacuum

9 tables have dead tuples > 100 with NULL `last_autovacuum`. High dead-tuple rates: `submission_events` (14.5%), `participants` (14.4%), `events` (14.8%), `pick_promotion_history` (7.5%). These tables are in the active pick lifecycle path. Requires: Phase 5 (monitoring) and autovacuum configuration fix in a dedicated lane.

### F6 — Empty historical partitions accumulate overhead

`provider_offer_history` partitions p20260517, p20260511, p20260512, p20260610, p20260612, p20260618, p20260622 all show 0 live rows with non-trivial size (45–218 MB). These are candidates for retirement, but only after archive proof. Requires: Phase 7 lane with row-count estimate and PM sign-off.

### F7 — `provider_offer_history_compact` exists alongside the partitioned table

`provider_offer_history_compact` (3.1 MB) exists as a separate non-partitioned table. Its purpose and relationship to the main 60-partition `provider_offer_history` table requires classification in Phase 2.

### F8 — 16 remote migrations have null names

16 out of 113 remote ledger entries have a null `name`. These are applied migrations without descriptive labels. Their content is unknown from the ledger alone. Classification required in Phase 2.

---

## Phase 1 Exit Criteria

| Criterion | Status |
|---|---|
| `supabase migration list --linked` captured | DONE |
| Local migration inventory captured | DONE |
| Remote-only, local-only, divergent state identified | DONE |
| Table size, dead tuples, autovacuum/analyze state captured | DONE |
| Partition state captured | DONE |
| `pnpm verify:static` green | DONE (exit 0) |
| R-level check green | DONE (no rules triggered) |
| NO DDL executed | CONFIRMED |
| NO `supabase db push` | CONFIRMED |
| NO `supabase migration repair` | CONFIRMED |
| NO dashboard schema edits | CONFIRMED |
| NO row updates, backfills, or deletes | CONFIRMED |
| NO `database.types.ts` changes | CONFIRMED |

All Phase 1 allowed actions completed. No forbidden actions taken.

## pnpm test:db

```
TAP version 13
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 256153.226666
```

## pnpm type-check and pnpm test

`pnpm type-check` — PASS (TypeScript project-references build, exit 0)

`pnpm test` (unit suite) — PASS (all suites pass, 0 failures)

Both commands passed as part of `pnpm verify:static` on branch `claude/utv2-1348-m1-db-finalization-phase1` before PR #1105 was opened.

## Merge SHA Binding

**Merge SHA:** `8561f51e6b337f1bd77d7d2d178a767699bfef07` — PR #1105 merged 2026-06-28

This proof is bound to merge commit `8561f51e6b337f1bd77d7d2d178a767699bfef07` on `main`.
