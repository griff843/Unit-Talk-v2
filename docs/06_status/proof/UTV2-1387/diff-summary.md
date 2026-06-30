# UTV2-1387 Diff Summary

## Summary

- Added adapter-level Discord routing for `discord:game-threads` in `apps/worker/src/delivery-adapters.ts`.
- Added adapter-level Discord DM routing for `discord:strategy-room` in `apps/worker/src/delivery-adapters.ts`.
- Added focused `node:test` coverage in `apps/worker/src/delivery-adapters.test.ts`.

## Files Changed

- `apps/worker/src/delivery-adapters.ts`
  - Adds optional `gameThreadMap` and `strategyRoomRecipientMap` inputs for the Discord adapter.
  - Resolves `discord:game-threads` by `metadata.eventId` or `metadata.eventName`.
  - Falls back to the mapped game-thread channel when no event thread is found and emits a structured worker warning.
  - Resolves `discord:strategy-room` by mapped recipient id or `metadata.strategyRoomRecipientId`, creates a DM channel through Discord, then posts the same Discord embed payload to that DM channel.
  - Keeps existing channel delivery behavior for regular Discord targets and preserves the existing unmapped-channel rejection behavior.
- `apps/worker/src/delivery-adapters.test.ts`
  - Covers game-thread routing to a mapped thread.
  - Covers game-thread fallback to the parent channel.
  - Covers strategy-room DM creation and message posting.
  - Covers retryable failure when Discord DM channel creation fails.

## Scope Notes

- This lane did not activate blocked targets in worker runtime target lists or distribution gates.
- This lane did not update `apps/worker/src/distribution-worker.ts` or risk-register docs because the execution packet narrowed allowed code scope to `apps/worker/src/delivery-adapters.ts` and `apps/worker/src/delivery-adapters.test.ts`, plus the required proof files.
- The adapter behavior is implemented and tested, but production activation still requires the separate target/governance work listed in the Linear AC.
