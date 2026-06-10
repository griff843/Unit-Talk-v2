# UTV2-1242 Diff Summary

## Change Summary

T2 data-canonical lane. Ingestor recovery: bounded queries, health state codes, hung-singleton logging.

## Files Changed

- `apps/ingestor/src/ingest-odds-api.ts` — add `beforeSnapshotAt: snapshotAt` to `findExistingCombinations` call
- `apps/ingestor/src/staleness.ts` — add `IngestorHealthCode` type, extend `IngestorOutageHealthInput`/`IngestorOutageHealthResult` with `code` field, add new health state detection
- `apps/ingestor/src/supervisor.ts` — extend `IngestorHealthInput`/`IngestorHealthReport` with `code` and new optional diagnostic fields; import `IngestorHealthCode` from `staleness.ts`
- `apps/ingestor/src/supervisor.test.ts` — add 6 new tests for HUNG_SINGLETON, API_KEY, DB_TIMEOUT, NO_SLATE, HEALTHY codes; assert `code` field in all existing tests
- `apps/ingestor/src/index.ts` — emit `hungSingletonReaped` in runtime summary; log `healthCode: 'HUNG_SINGLETON'` when stale runs reaped

## Impact

- `findExistingCombinations` in odds-api path is now bounded to `beforeSnapshotAt` — prevents full-table scan on `provider_offer_history`
- Health check output now emits structured `code` field for monitoring/alerting
- Startup logs emit `HUNG_SINGLETON` code when stale running cycles are detected
- Ghost MLB run `e28fe752` operationally cleared (startup recovery code in place)

## Guardrails Honored

- No provider offer data dropped or rewritten
- Closing-line marking not bypassed or skipped
- No Redis / Temporal
- No P3 certification
- No CLV / ROI claims
- No UTV2-884 / UTV2-885 / UTV2-1042

## Tier C Follow-up Identified

`upsertBatch` idempotency check in `packages/db/src/runtime-repositories.ts` is a separate
Tier C path touch — not included in this lane. Primary blocking timeouts resolved by this lane +
the composite index on `(provider_event_id, snapshot_at)` on `provider_offer_history`.

## SHA Binding

Verified source SHA: 25e03d78ab584bd1fc9f0e6b6c125a5ce10ac51b
Merge SHA: 891512f15a1308aa4c4525afc4bee6c6a23f1117
