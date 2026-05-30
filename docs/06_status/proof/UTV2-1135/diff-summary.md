---
issue: UTV2-1135
title: INIT-4.2.1 — updatePayload Surface Removal
tier: T2
executor: claude
branch: claude/utv2-1135-init-421-updatepayload-surface-removal
---

## Summary

Removes the `updatePayload()` mutable settlement surface from the repository layer.
No migration required — the method existed only in application code and was never
called in any production path.

## Files Changed

| File | Change |
|------|--------|
| `packages/db/src/repositories.ts` | Removed `updatePayload()` from `SettlementRepository` interface |
| `packages/db/src/runtime-repositories.ts` | Removed `InMemorySettlementRepository.updatePayload()` and `DatabaseSettlementRepository.updatePayload()` |

## Caller Verification

Explore scan confirmed zero production callers across `apps/api`, `apps/worker`,
`apps/ingestor`. Settlement corrections follow the append-only `corrects_id` FK
pattern via `recordPickSettlementCorrection()` in `apps/api/src/settlement-service.ts`.

## Constraints Satisfied

- No replacement mutable settlement path introduced
- Existing `corrects_id` correction path remains canonical and untouched
- No DB migration (application-layer removal only)
- No capital deployment, no treasury operations, no scaling runtime
