# UTV2-1398 — Diff Summary

## Change

One-line addition to `classifyMarketFamily()` in
`packages/domain/src/scoring/promotion-weight-profiles.ts`: added
`key === 'nba-spread'` to the existing game-line match list.

## Why

Owner-approved narrow scope (Linear UTV2-1398, PM gate satisfied): live
`picks.market` values `game_total_ou` and `nba-spread` were both falling
through `classifyMarketFamily()` to `'unknown'`. Independent code
verification prior to this lane confirmed `game_total_ou` already matches via
`key.includes('game_total')` — no change needed there. `nba-spread` matched
none of the existing literals/substrings and fell through to `unknown`,
which carries a hard 72-point score cap and 0.85x multipliers in
`applyPromotionModifiers()` vs. `game-line`'s 100-point cap and 1.1x edge
multiplier — confirmed scoring-adjacent per the issue's PM gate.

## Explicitly not changed

- `MARKET_FAMILY_PROMOTION_MODIFIERS` weight values — untouched.
- Promotion thresholds, Kelly sizing, band assignment — untouched.
- No other classifier pattern added or removed.

## Files touched

- `packages/domain/src/scoring/promotion-weight-profiles.ts` (+1 line)
- `packages/domain/src/scoring/promotion-weight-profiles.test.ts` (+1 fixture test)

## Revert path

Single-line revert: remove the `key === 'nba-spread'` clause. No migration,
no data change, no other file depends on this addition.
