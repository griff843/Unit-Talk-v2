# UTV2-1308 Diff Summary

## Summary

UTV2-1308 expands the DB Health Tripwire monitor to close the G-CONST-12 parity gap against `docs/05_operations/DB_MAINTENANCE_RETENTION_SPEC.md` Section 5.

## Files Changed

- `.github/workflows/db-health-tripwire.yml` — aligns scheduled monitor defaults with the ratified Section 5 thresholds and passes new threshold env vars to the monitor.
- `scripts/ops/db-health-tripwire.ts` — expands read-only hot-table checks to `system_runs`, `raw_payloads`, `odds_snapshots`, `provider_offer_history`, and `game_results`; aligns size and statement-timeout thresholds; adds the Section 5.5 TOAST bloat estimate for `raw_payloads` and `odds_snapshots`.
- `docs/06_status/proof/UTV2-1308/verification.md` — captures verification evidence.
- `docs/06_status/proof/UTV2-1308/diff-summary.md` — this summary.

## Scope Notes

- All DB checks remain read-only SELECT/log inspection paths.
- No migrations, schema changes, DB mutations, runtime delivery changes, or docs outside the allowed proof path were touched.
- The monitor still does not duplicate Track A ingestor/pipeline health checks.
