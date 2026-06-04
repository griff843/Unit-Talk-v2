# UTV2-1200 Diff Summary — Injury/Player Status Guard

## Issue
UTV2-1200 — Wave 1 — Injury/player status guard in evaluatePromotionEligibility

## Tier
T2

## Branch
codex/utv2-1200-injury-player-status-guard

## Files Changed

### apps/api/src/promotion-service.ts (+24 lines)

Extended all 6 occurrences of the `riskBlocked` computation to also block when `playerAvailabilityStatus` in pick metadata is one of `'OUT'`, `'OUT_INDEFINITELY'`, or `'INJURED_OUT'`.

Pattern applied at each site:

```typescript
// Before
riskBlocked: readMetadataBoolean(canonicalPick.metadata, 'riskBlocked') ?? false,

// After
riskBlocked: (readMetadataBoolean(canonicalPick.metadata, 'riskBlocked') ?? false) ||
             ['OUT', 'OUT_INDEFINITELY', 'INJURED_OUT'].includes(
               readMetadataString(canonicalPick.metadata, 'playerAvailabilityStatus') ?? ''
             ),
```

Locations patched:
1. `makeInput()` in `evaluateAllPoliciesEagerAndPersist` (line ~264) — primary eval input
2. `makeSnapshot().gateInputs` in `evaluateAllPoliciesEagerAndPersist` (line ~342) — snapshot record
3. `makeInput()` in `buildSmartFormQualifiedResult` (line ~557) — smart-form eval input
4. `makeSnapshot().gateInputs` in `buildSmartFormQualifiedResult` (line ~630) — smart-form snapshot
5. `evaluatePromotionEligibility()` in `persistPromotionDecisionForPick` (line ~875) — single-policy eval
6. `snapshot.gateInputs` in `persistPromotionDecisionForPick` (line ~929) — single-policy snapshot

No new imports added. `readMetadataString` was already present in the file.

### apps/api/src/promotion-service-stale-data.test.ts (+135 lines)

Added 4 new unit tests for UTV2-1200:

1. `UTV2-1200: pick with playerAvailabilityStatus=OUT is suppressed (riskBlocked)` — verifies `resolvedTarget=null`, `qualified=false`, `promotion_target=null`
2. `UTV2-1200: pick with playerAvailabilityStatus=OUT_INDEFINITELY is not promoted` — verifies `resolvedTarget=null`, `promotion_target=null`
3. `UTV2-1200: pick with playerAvailabilityStatus=INJURED_OUT is not promoted` — verifies `resolvedTarget=null`, `promotion_target=null`
4. `UTV2-1200: pick with playerAvailabilityStatus=ACTIVE is NOT suppressed by injury guard` — verifies ACTIVE players are not blocked by the guard

## Constraints Respected

- Did NOT modify `packages/domain/src/` — `evaluatePromotionEligibility` already handles `riskBlocked: true`
- Did NOT add new imports from external packages
- Did NOT activate SGO
- Did NOT touch `candidate-scoring-service.ts`
- Did NOT make refactoring changes beyond scope
