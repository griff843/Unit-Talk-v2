# Diff Summary: UTV2-1141 — INIT-4.4.1 Attribution Engine

## Files Changed

| File | Change |
|---|---|
| `packages/domain/src/attribution/attribution-engine.ts` | New — core Attribution Engine module |
| `packages/domain/src/attribution/attribution-engine.test.ts` | New — 23 tests |
| `packages/domain/src/attribution/index.ts` | New — re-exports |
| `packages/domain/src/index.ts` | Modified — add attribution export |

## Summary

Implements `AttributionEngine` that decomposes realized PnL into model, execution, and luck components. Pure domain computation — no DB, no I/O, deterministic replay-safe.

**Decomposition model:** `realized_pnl = model_component + execution_component + luck_component`

- `model_component_bps`: EV at bet time (model's predicted edge)
- `execution_component_bps`: CLV captured after entry (clv_at_close - clv_at_bet)
- `luck_component_bps`: residual variance

Records without feature snapshots are tagged `insufficient_data` and excluded from aggregate decompositions. Fail-closed on missing/invalid inputs.
