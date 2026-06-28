# Diff Summary — UTV2-1330 Table Health / Autovacuum Proof

## Issue
UTV2-1330 — Table Health / Autovacuum Proof  
Milestone: M1 — DB Finalization  
Tier: T2

## Scope
Read-only DB-health proof. No production data mutations. No source code changes.

## Files Changed
- `docs/06_status/proof/UTV2-1330/verification.md` — verification log with DB query results and verdict
- `docs/06_status/proof/UTV2-1330/diff-summary.md` — this file

## Summary
This lane produces a proof-only artifact confirming the health of hot write tables (`system_runs`, `picks`, `provider_offer_history`, `distribution_outbox`) after the UTV2-1294 bloat incident. No code was modified; all evidence was gathered via read-only SELECT queries against `pg_stat_user_tables` and `pg_class`.

Key finding: the historical `system_runs` bloat (1.2 GB / 130 rows) is fully resolved. The table now holds 3.3 million live rows at 1220 MB, representing healthy density (~369 bytes/row). Custom autovacuum settings are in place and will trigger at the appropriate threshold.

## Merge SHA

7c4e62aea5c3a9bdac22502d96dcd295b70bbc7a
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1101
**Merged:** 2026-06-28
