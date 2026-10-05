# UTV2-1799 Diff Summary

PR: https://github.com/griff843/Unit-Talk-v2/pull/1716
Base: 16d5f5d2264b92f65ead886261d3b12b671c46ad

- scripts/ops/ingestor-health-check.ts: read provider_offer_current.updated_at, not the legacy provider_offers view.
- scripts/ingestor-supervisor.ts: correct its independent freshness query; preserve query errors; permit import without running the supervisor; stop uses only local state/process checks so DB failure cannot block termination.
- scripts/ops/provider-offer-column-guard.test.ts: repo-wide AST guard, both original-call-site inversions, and actual reader request/health regressions.
- scripts/ingestor-alert-check.test.ts: remove the ineffective single-file regex.
- package.json: add only the new guard to the existing required test:ops command.
- apps/api/src/database-smoke.test.ts: SELECT-only checks of both real readers, positively restricted to staging, with absolute module resolution and root child cwd from a non-root caller.
- Normal per-issue lane, sync, and proof metadata only.

No migration, workflow, thresholds, provider activation, runtime restart, or delivery-policy changes.
The scheduled monitor already queries schema-valid system_runs, provider_cycle_status, and game_results columns; it is unchanged.

Merge SHA: pending merge
