# Diff summary — UTV2-1815

Anchor: `c96c9922cd411304488c6f63a6f7a5f26374ffa1`

## packages/domain/src/attribution/attribution-engine.ts (+93 / −7)

- New shared stake contract: `StakeUnitsStatus`, `StakeUnitsResolution`, `resolveStakeUnits`,
  `ATTRIBUTION_INVALID_STAKE_UNITS`, `ASSUMED_FLAT_STAKE_UNITS`. This is the single definition of
  what an unusable stake is; all three call sites consume it.
- `AttributionRecord` gains optional `stake_units_status`, so a produced record states whether its
  stake was observed or assumed.
- `attributePick` no longer does `input.stake_units ?? 1`; it resolves the stake and tags the record.
- `validateAttributionInput` rejects an unusable supplied stake. Since `attributePick` validates
  first, an unusable stake now yields a refusal rather than a record computed at an assumed 1.

## apps/api/src/grading-service.ts (+49 / −12)

- `computeProfitLossUnits` returns `number | null` and returns null on an unknown stake, replacing
  `const stake = stakeUnits ?? 1`.
- New `readStakeUnitsResolution` folds a missing/non-numeric column to `null` — a database column
  that always exists means a missing value is unknown, never a flat-bet default.
- `postSettlementRecapIfPossible` refuses to publish when the stake is not canonical, and logs why.
  Rendering an unknown stake would require changing the non-nullable `RecapEmbedInput`, which is out
  of scope.

## apps/api/src/settlement-service.ts (+12 / −4)

- Behaviour unchanged. `computeProfitLossUnits` and `buildStakeIntegrityPayload` now call
  `resolveStakeUnits` instead of each carrying a private copy of the rule.

## Tests (+239 / 0)

- `attribution-engine.test.ts` +6: the three-way resolution, NULL and NaN rejection through both
  `validateAttributionInput` and `attributePick`, and record tagging.
- `grading-service.test.ts` +3: recap refused for NULL and for NaN, still published for a real stake.
- `settlement-service.test.ts` +2: NaN refused identically to the already-covered NULL, plus a
  negative control asserting a real stake still yields a real profit/loss.

All new tests are paired with mutations (M1–M5) that make each control fail on the condition it
names. Receipts in `verification.md`.
