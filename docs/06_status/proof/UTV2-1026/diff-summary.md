# Proof: UTV2-1026 — Automated Model Performance Monitoring

**Issue:** UTV2-1026
**Tier:** T2
**Branch:** codex/utv2-1026-automated-model-performance-monitoring
**Executor:** codex-cli

---

## Deliverables

| Deliverable | Status | Path |
|---|---|---|
| Monitoring mode added to roi-by-sport.ts | Done | `scripts/roi-by-sport.ts` |
| GHA cron workflow | Done | `.github/workflows/model-performance-monitor.yml` |
| Model performance log seed | Done | `docs/06_status/model-performance-log.md` |

---

## Changes summary

### `scripts/roi-by-sport.ts` (+436 lines, -36 lines)

New exports added:
- `ModelEdgeTier` — union type: `UNPROVEN | DEVELOPING | STRONG | ELITE`
- `ModelPerformanceSnapshot` — full snapshot interface (tier, ROI, CLV coverage, W/L/P, units)
- `ModelPerformanceAlert` — alert with `reason`, `severity`, `message`
- `ModelPerformanceMonitorResult` — `{ snapshot, previousSnapshot, alerts }`
- `buildModelPerformanceSnapshot(rows, afterDate)` — builds snapshot from settled rows
- `computeObservableModelEdgeTier(input)` — tier gate logic per MODEL_EDGE_ACCEPTANCE_STANDARD
- `evaluateModelPerformanceAlerts(snapshot, previous)` — fires alerts for tier changes and ROI boundary crossings
- `buildMonitorResult(rows, afterDate, previous)` — orchestrates snapshot + alert evaluation
- `printMonitorReport(result)` — human-readable monitor output

CLI flags added:
- `--monitor` / `--monitor-json` — activates monitoring mode (text or JSON output)
- `--state-file=<path>` — reads previous snapshot and writes updated snapshot for cross-run diffing

Default behavior (`pnpm roi-by-sport`) unchanged — monitoring mode only activates when flag is present.

### `.github/workflows/model-performance-monitor.yml` (new)

- Cron: `7 6 * * *` (daily at 06:07 UTC)
- Runs `tsx scripts/roi-by-sport.ts --monitor-json --state-file=...`
- Persists snapshot via `actions/cache` for cross-run tier diff
- Uploads `monitor-result.json` as a workflow artifact (30-day retention)
- Posts Discord embed alert when `alerts.length > 0`
- Appends daily entry to `docs/06_status/model-performance-log.md`
- Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UNIT_TALK_OPS_ALERT_WEBHOOK_URL`

### `docs/06_status/model-performance-log.md` (new)

Seed file with header comment. Workflow appends a dated table entry per daily run.

---

## Alert conditions

| Reason | Severity |
|---|---|
| `tier_changed` (upward or downward) | warning |
| `roi_threshold_crossed` (boundary: 0%, 2%, 4%) | warning |
| `sample_milestone_reached` (N=50,100,200,250,500) | warning |
| `negative_roi` (ROI < 0) | critical |
| `low_clv_coverage` (CLV coverage < 20% when N >= 50) | warning |

---

## Files changed

```
scripts/roi-by-sport.ts                                 (modified)
.github/workflows/model-performance-monitor.yml         (new)
docs/06_status/model-performance-log.md                 (new)
docs/06_status/proof/UTV2-1026/diff-summary.md          (new)
docs/06_status/proof/UTV2-1026/verification.log         (new)
```
