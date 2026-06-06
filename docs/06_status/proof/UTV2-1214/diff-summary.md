## Diff Summary — UTV2-1214

**PR #978:** Wave 5 efficiency wiring — pace cap 1.5→1.3 + high_pace_flag

### packages/domain/src/features/efficiency.ts

- `EfficiencyFeatures` interface: added `high_pace_flag: boolean` field
- `extractEfficiencyFeatures()`: changed `Math.min(1.5, ...)` → `Math.min(1.3, ...)` in pace clamp; added `highPaceFlag = paceAdjustment > 1.25` (evaluated on raw input before clamping); added `high_pace_flag: highPaceFlag` to return value

### packages/domain/src/features/efficiency.test.ts

- Updated existing test `clamps pace adjustment to [0.5, 1.5]` → `[0.5, 1.3]`: changed assertion from `1.5` to `1.3` and added `high_pace_flag: true` assertion for input pace of 2.0

### packages/domain/src/models/stat-distribution.ts

- `StatProjectionOutput` interface: added `high_pace_flag?: boolean` (optional)
- `computeStatProjection()`: added `high_pace_flag: efficiency.high_pace_flag` to return data

### packages/domain/src/models/stat-distribution.test.ts

- `baseEfficiency` fixture: added `high_pace_flag: false` (new required field)
- New describe block `efficiency pace cap + high_pace_flag — UTV2-1214`:
  1. pace > 1.3 (capped) → `high_pace_flag: true` passes through to output
  2. pace between 1.25 and 1.3 → `high_pace_flag: true`, not capped further
  3. pace ≤ 1.25 → `high_pace_flag: false` in output

### docs/06_status/lanes/UTV2-1214.json

- `file_scope_lock`: added `packages/domain/src/features/efficiency.test.ts` (ancillary fix required to update pace cap assertion and `high_pace_flag` field)
