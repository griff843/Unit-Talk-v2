# Diff Summary: UTV2-1212 - Player Form Wiring

**Branch:** `codex/utv2-1212-player-form-wiring`
**Tier:** T1
**Lane type:** modeling

## Files changed

### `packages/domain/src/features/player-form.ts`

- Added `PlayerFormSignal`, a bounded [0, 1] player-form scoring signal contract.
- Added `resolvePlayerFormSignal(features)`, a pure resolver that combines:
  - stat trend component
  - consistency component
  - projected-minutes availability component
- Resolver uses only player/game-log derived fields. It does not read market lines, odds, DB state, env, HTTP, or app code.

### `packages/domain/src/models/stat-distribution.ts`

- Wires `resolvePlayerFormSignal()` into `computeStatProjection()`.
- Emits `player_form_score` on real stat projection outputs.
- Includes `stat_trend`, `consistency_score`, and `player_form_score` in the deterministic feature vector hash.
- Adds optional `playerForm_weight` input for sport-specific player-form adjustment.
  - Default is `0`, so existing callers keep the previous expected-value path.
  - When supplied, the adjustment scales expected value from the bounded player-form signal.
  - Variance remains the existing four-component model.
  - No market input is used as a model feature.

## What was not changed

- No DB migrations.
- No generated DB type edits.
- No app-to-app imports.
- No runtime service edits outside the allowed packet scope.
- No lifecycle, promotion, settlement, or distribution authority changes.
