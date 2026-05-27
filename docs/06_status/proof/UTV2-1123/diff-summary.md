# Diff Summary: UTV2-1123 — Advisory-Path Removal (INIT-3.3.4)

## Implementation SHA: d45c5562b79a5585dd4ec388ebf377d02e227699
## Tier: T2

## Files Changed

### `packages/domain/src/probability/calibration.ts`
**Advisory path removed: proxy reports with hardcoded zero metrics**
- Added `has_sufficient_data: boolean` to `SliceCalibrationMetrics`
- Insufficient-data groups (< 10 samples) now set `has_sufficient_data: false` instead of emitting `brierScore: 0, ece: 0` which looked like perfect calibration

**Advisory path removed: 'green' for unknown calibration state**
- `CalibrationAlertLevel` extended: `'green' | 'warning' | 'critical' | 'insufficient_data'`
- `computeCalibrationAlertLevel()` now returns `'insufficient_data'` for samples < `minSampleForAlert` instead of `'green'`
- Callers must not treat `'insufficient_data'` as passing calibration

### `packages/domain/src/probability/calibration.test.ts`
- Updated: `'returns green for sample below minSampleForAlert'` → `'returns insufficient_data for sample below minSampleForAlert'`
- Assertion updated: `'green'` → `'insufficient_data'`

### `packages/domain/src/system-health/system-health-report.ts`
**Advisory path removed: default 'green' for small sample in generateModelReviewPacket()**
- `calibration_alert_level` now defaults to `'insufficient_data'` when `sample_size < minSampleForAlert`
- Small-sample models are no longer silently classified as 'green' (false confidence eliminated)

### `packages/domain/src/models/calibration-proof.ts` (new)
**Calibration proof bundle (INIT-3.3.4 required proof artifact)**
- `buildCalibrationProof()` composes INIT-3.3.1/3.3.2/3.3.3 into one reproducible proof
- Chain: `buildCalibrationReport()` → `evaluateCalibrationGate()` → `buildDeploymentHold()` → `evaluateCohortHolds()`
- All inputs stored; identical replay guaranteed

### `packages/domain/src/models/calibration-proof.test.ts` (new)
- 10 tests including 3 `[ADVERSARIAL]`:
  1. Injected breach → report fails → gate blocks → hold placed → blocks_scoring=true
  2. Cohort-only degradation → cohort hold fires, no model-level hold
  3. Reproduced metrics identical on replay (determinism guarantee)

### `packages/domain/src/models/index.ts`
- Added `export * from './calibration-proof.js'`

### `package.json`
- Added `calibration-proof.test.ts` to `test:domain-features`

## Invariants Verified

| Invariant | Status |
|---|---|
| No advisory-only calibration path remains | PASS — 'insufficient_data' replaces all false 'green' |
| Calibration is fail-closed | PASS — missing data fails-closed in all paths |
| Calibration enforcement re-runs on replay | PASS — buildCalibrationProof() is pure + deterministic |
| Removed advisory paths recorded | PASS — this diff summary |
