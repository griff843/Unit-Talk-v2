# UTV2-1504 Verification

## Verification

- [x] `pnpm ops:execution-state -- --json`: PASS. At 2026-07-14T04:50:06Z, one Codex hygiene lane was active; Codex capacity was 1/4 and Claude capacity was 0/2. No blocked lanes or merge-risk findings were reported.
- [x] `npx tsx --test scripts/ops/concurrency-simulation.test.ts`: PASS — 23 tests passed, including the expired-trial path that rejects a seventh lane at the base cap.
- [x] `pnpm type-check`: PASS (as part of `pnpm verify`).
- [x] `pnpm test`: PASS (as part of `pnpm verify`).
- [x] `pnpm verify`: PASS — static gate, live database smoke tests, and live proof suite completed successfully. One UTV2-1282 assertion was skipped because the latest provider history row is outside its 72-hour lookback window; the test reports this as stale provider data, not a code regression.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS — no R-level rules matched this docs-only diff.

## Issue-specific verification

The effective configuration was evaluated at the audit timestamp. Although the trial block remains enabled in source, `allowed_until` is 2026-06-26; therefore `getEffectiveConfig()` returned `trial_active: false` with the base 6 total / 2 Claude / 4 Codex limits. The simulation suite independently verifies that an expired trial rejects the seventh lane.

## Required-artifact status

`docs/06_status/proof/UTV2-1504/model-routing.json` is required by the lane manifest but is absent. It is not in this execution packet's allowed file scope, so this lane cannot create it without explicit scope authorization or tooling that generates it. This is a closeout blocker; it does not affect the audit's current-control conclusion.

## SHA binding

Head SHA: c88d3b8a92903665c52875afd8159cd5b9373e01
Merge SHA: dca6b52c38de1df980b2b44ac72a2130d7f0c2c4
