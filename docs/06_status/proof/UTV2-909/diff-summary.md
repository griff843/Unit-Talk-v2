# UTV2-909 Diff Summary

merge_sha: 5e089e770f2706ffe2c6f9ee1274bc4303c50812

Fixed the ingestor staleness alert offers freshness check:

- `scripts/ingestor-alert-check.ts`: Replaced the `provider_offers.snapshot_at` query with `provider_cycle_status.updated_at` filtered for `stage_status = 'merged'`. The old column is SGO's provider-side timestamp (frozen at 2026-04-29); the new column is written by the ingestor on every successful merge pass.
- `scripts/ingestor-alert-check.test.ts`: Updated test description to reflect the new data source. All 4 tests pass.

No schema changes. No shared contract changes. No migration.
