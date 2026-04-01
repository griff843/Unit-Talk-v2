# Calibration Module Status

**Status:** AVAILABLE but NOT WIRED into live scoring path
**Issue:** UTV2-202

## What exists

- `engine.ts` — Platt scaling (logistic), histogram binning, identity calibration
- `calibration.test.ts` — tests for all three methods
- Brier score, log-loss, ECE computation

## Why it's not wired

Calibration requires trained parameters (Platt a, b coefficients) derived from
historical outcomes. With < 100 graded picks, training would overfit. Wiring
untrained/hardcoded parameters would be worse than no calibration.

## When to wire

Wire calibration into the live scoring path when:
1. >= 500 graded picks with CLV data exist
2. Training data spans >= 2 sports and >= 30 days
3. ECE (Expected Calibration Error) can be measured on held-out data
4. A trained parameter set produces measurable improvement over uncalibrated

This is a Phase 7 (Syndicate Lane) prerequisite.

## What NOT to claim

Do not claim "calibrated" or reference calibration in user-facing surfaces
until this module is wired with trained parameters. The model version string
reflects the computation architecture, not calibration status.
