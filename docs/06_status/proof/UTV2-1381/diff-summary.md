# UTV2-1381 Diff Summary

## Summary

- Updated `apps/api/src/promotion-service.ts` so exposure-gate promotion suppression persists `metadata.band = "SUPPRESS"`.
- Added `band: "SUPPRESS"` to the exposure-gate winner history payload and non-winning policy history payloads.
- No repository, schema, domain threshold, or distribution routing changes were made.

## Files Changed

- `apps/api/src/promotion-service.ts` — closes the remaining promotion completion path that omitted band persistence by writing the persisted SUPPRESS band through `metadataPatch` and promotion-history payloads.

## Scope Notes

- The repository write path already merges `metadataPatch` into `picks.metadata` in both InMemory and Database implementations.
- This change preserves the existing policy decision behavior; it only makes the exposure-gate suppression path match the other promotion persistence paths.
