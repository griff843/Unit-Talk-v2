## Summary

UTV2-1026: Analytics monitoring addition. No runtime submission or scoring logic changed — new monitoring mode added to existing `roi-by-sport.ts` script, plus a GHA cron workflow for daily execution.

## Evidence

- `scripts/roi-by-sport.ts` extended with monitoring-only code paths (no changes to existing ROI calculation logic)
- New `.github/workflows/model-performance-monitor.yml` — GHA workflow, no live DB writes
- `pnpm verify` PASS, `pnpm test` 479/479 PASS, `pnpm type-check` PASS

## Verification

- [x] Type-check green
- [x] All 479 tests pass
- [x] R-level check: PASS
- [x] No runtime code path modified — analytics/monitoring addition only
