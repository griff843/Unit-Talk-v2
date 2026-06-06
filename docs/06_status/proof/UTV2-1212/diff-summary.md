## Summary

**Issue:** UTV2-1212 — Wave 5: player-form wiring into computeStatProjection

### Files changed

- `packages/domain/src/features/player-form.ts` — adds `resolvePlayerFormSignal()` and `PlayerFormSignal` interface
- `packages/domain/src/models/stat-distribution.ts` — imports and wires form signal; adds `playerForm_weight` to `ProjectionInput`; emits `player_form_score` in output

### What changed

**player-form.ts:**
- `PlayerFormSignal` interface: `{ score, trend_component, consistency_component, availability_component }`
- `resolvePlayerFormSignal(features)`: weighted score — trend 35%, consistency 40%, availability (minutes/36) 25%, bounded [0,1]

**stat-distribution.ts:**
- `ProjectionInput.playerForm_weight?: number` — sport-specific weight (default 0, backward-compatible)
- Form adjustment: `expectedValue *= (1 + weight × (score − 0.5) × 2)`; neutral at score=0.5
- `StatProjectionOutput.player_form_score?: number` — emitted for observability
- Score added to deterministic feature vector hash

### What did NOT change

- Sport scoring files — weight slots were already declared; callers pass them via `playerForm_weight`
- No schema changes, no migrations, no SGO wiring, no certification advancement
- 72h stale-guard already enforced upstream in `extractPlayerFormFeatures`

## Evidence

- pnpm verify: PASS
- pnpm test:db: 7/7 pass
- R-level: PASS, no artifacts required
- 4 new deterministic unit tests
