# UTV2-1225 Diff Summary

**Merge SHA:** `37febff250d5543d8d9ff162405e1a945a9dec43` (PR #984, squash-merged to main 2026-06-07)

## Summary

UTV2-1225 adds fail-closed finite-number guards to `computeStatProjection` so malformed `NaN`, `Infinity`, negative variance, and invalid home/away factor inputs cannot propagate into projection math, probability fitting, confidence, or feature-vector hashing.

## Files Changed

- `packages/domain/src/models/stat-distribution.ts`
  - Adds finite-value validation before projection math runs.
  - Rejects non-finite `line`, `opportunity_projection`, `efficiency_projection`, player-form signal inputs, player-form weight, opportunity/efficiency hash inputs, and `home_away_factor`.
  - Rejects negative or non-finite variance contributors before total variance and confidence are computed.

- `packages/domain/src/models/stat-distribution.test.ts`
  - Converts the file to `node:test` `test()` usage.
  - Adds UTV2-1225-focused coverage for `NaN`, positive/negative infinity, negative variance contributors, invalid player-form adjustment inputs, and invalid home/away factor.

## Scope

Implementation stayed in the allowed domain model files plus required proof artifacts.

No database schema, runtime delivery, lifecycle, promotion routing, app, or generated type files were changed.
