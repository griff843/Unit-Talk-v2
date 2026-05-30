# UTV2-1133 Diff Summary

## Summary

- Added `confirmExecutionReceipt()` as the API-facing service for re-confirm receipt handling backed by `ExecutionIntentRepository` and `ReceiptRepository`.
- Made `recordDistributionReceipt()` idempotent when a matching receipt idempotency key already exists for the same outbox row and receipt type.
- Added focused `node:test` coverage for first confirm, duplicate re-confirm reuse, and empty idempotency-key rejection.

## Files Changed

- `apps/api/src/distribution-receipt-service.ts` - checks for an existing matching receipt before insert and treats repository duplicate-key collisions as idempotent when the stored receipt matches.
- `apps/api/src/execution-confirmation-service.ts` - appends or reuses an execution intent by idempotency key, computes a replayable inputs hash, and records or reuses the receipt.
- `apps/api/src/execution-confirmation-service.test.ts` - covers idempotent re-confirm behavior using in-memory repositories.
- `docs/06_status/proof/UTV2-1133/diff-summary.md` - this implementation summary.
- `docs/06_status/proof/UTV2-1133/verification.md` - verification evidence for this lane.

## Scope

All implementation and proof changes are within the UTV2-1133 allowed file scope.

## SHA Binding

merge_sha: 80f349ada9848ac42fce67ca39a67c205a23f13f
pr: https://github.com/griff843/Unit-Talk-v2/pull/933
