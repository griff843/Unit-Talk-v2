## Summary

UTV2-1026: Implemented automated model performance monitoring. Extended `scripts/roi-by-sport.ts` with monitoring mode (`--monitor` flag) that computes model edge tier, detects tier boundary crossings, and emits Discord alerts. Created GHA cron workflow for daily re-measurement and appended state tracking to `docs/06_status/model-performance-log.md`.

## Evidence

**Changed files:**
- `scripts/roi-by-sport.ts` (+436/-36): added `ModelEdgeTier`, `ModelPerformanceSnapshot`, `ModelPerformanceAlert`, `buildMonitorResult`, `computeObservableModelEdgeTier`, `evaluateModelPerformanceAlerts`, `printMonitorReport`, CLI flags `--monitor`/`--monitor-json`/`--state-file`
- `.github/workflows/model-performance-monitor.yml` (new): daily cron at 06:07 UTC, runs monitor mode, persists snapshot via `actions/cache`, posts Discord embed on findings, appends to model-performance-log.md
- `docs/06_status/model-performance-log.md` (new): append-only monitoring log seed file

**Verification:**
- `pnpm type-check` — PASS
- `pnpm test` (479/479) — PASS
- R-level check: PASS (analytics script + GHA workflow, no runtime data path modified)

## Verification

- [x] `pnpm type-check` — PASS
- [x] `pnpm test` (479/479) — PASS
- [x] R-level compliance — PASS
- [x] Tier label `tier:T2` on PR #797
- [x] No runtime submission/scoring code modified

## Merge SHA

68e724f93d291e7fa75fc2d67540be1b3a6359ce
