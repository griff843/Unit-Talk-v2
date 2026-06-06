## Diff Summary — UTV2-1215

**PR #979:** Wave 5 game-context wiring into computeStatProjection

### packages/domain/src/models/stat-distribution.ts

**Import added:**
```typescript
import type { GameContextFeatures } from '../features/game-context.js';
```

**StatProjectionOutput — 4 new optional fields:**
```typescript
// Game context (UTV2-1215)
projected_game_total?: number;
is_back_to_back?: boolean;
rest_days?: number;
home_away_factor?: number;
```

**ProjectionInput — 1 new optional field:**
```typescript
gameContext?: GameContextFeatures;
```

**computeStatProjection — Step 1c added:**
```typescript
// ── Step 1c: Home/Away Trim (UTV2-1215) ───────────────────────────────
const homeAwayFactor = gameContext?.home_away_factor ?? 1.0;
const expectedValue = round4(formAdjustedValue * homeAwayFactor);
```

**Return value — game context fields conditionally spread:**
```typescript
...(gameContext !== undefined ? {
  projected_game_total: gameContext.projected_game_total,
  is_back_to_back: gameContext.is_back_to_back,
  rest_days: gameContext.rest_days,
  home_away_factor: gameContext.home_away_factor,
} : {}),
```

**Feature vector hash — home_away_factor included:**
```typescript
home_away_factor: input.gameContext?.home_away_factor ?? 1.0,
```

### packages/domain/src/models/stat-distribution.test.ts

- Added `GameContextFeatures` import
- New `describe('game-context wiring — UTV2-1215')` block with 3 tests:
  1. `back-to-back (rest_days:0) → is_back_to_back:true in output`
  2. `home factor (1.012) → expected_value increases ~1.2% vs neutral`
  3. `no gameContext → game-context fields absent, expected_value unchanged`
