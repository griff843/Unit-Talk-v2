# Diff Summary — UTV2-1348: M1 DB Phase 1

**Issue:** UTV2-1348  
**Branch:** `claude/utv2-1348-m1-db-finalization-phase1`  
**Captured:** 2026-06-28  
**Production state is read-only** — no DDL, no mutations, no schema edits.

## Key Findings

- **Migration ledger fully divergent:** 113 remote migrations, 0 matching local files. Local directory holds only a baseline snapshot (`00000000000000`) not tracked in the remote ledger. 16 remote entries have null names. Phase 2 (Migration Queue Classification) is the required next lane.

- **`system_runs` autovacuum missing — critical:** 1.22 GB table with 31,380 dead tuples, NULL autovacuum/autoanalyze ever run. 3.3M live rows growing continuously. This was the root cause table in the prior write-path degradation incident. Requires a dedicated vacuum/autovacuum config fix lane before further degradation.

- **`provider_offers_legacy_quarantine` is a 6.5 GB zombie:** 0 live rows, 0 dead tuples, NULL autovacuum. This is the renamed legacy provider_offers table with no runtime function. Requires Phase 7 PM-approved destructive maintenance lane (archive proof, before-count, maintenance window).

- **9 active-path tables lack autovacuum coverage:** `submission_events` (14.5% dead), `participants` (14.4% dead), `events` (14.8% dead), `pick_promotion_history` (7.5% dead), `submissions` (7.0% dead), `pick_lifecycle` (3.5% dead), among others. All are in the live pick pipeline. Requires Phase 5 monitoring + autovacuum config fix.

- **TOAST-dominated blob tables:** `raw_payloads` (693 MB for 14K rows, 99% TOAST) and `odds_snapshots` (427 MB for 8K rows, 99% TOAST). Phase 4 retention/archive analysis required before any action.

## What This Lane Does NOT Do

This lane adds proof documents only. No code changes, no schema changes, no DB mutations. `pnpm verify:static` exits 0. R-level check: no rules triggered.
