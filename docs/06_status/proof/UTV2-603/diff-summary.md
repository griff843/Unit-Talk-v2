# UTV2-603 Diff Summary

## Scope

- Added shared structured error capture primitives in `@unit-talk/observability`.
- Wired centralized runtime error capture into API, worker autorun, and ingestor autorun paths.
- Kept API client-side 4xx failures in metrics/logging while sending only 5xx runtime failures to error tracking.
- Added read-only operator observability payload at `GET /api/operator/observability`.
- Added the HTML dashboard Observability section with stack choice, exported runtime metrics, and alert condition status.

## Stack Decision

- Logs: Loki via existing `LOKI_URL` writer support.
- Metrics: JSON/Prometheus-compatible in-process metrics snapshots and operator runtime summaries.
- Errors: structured error events emitted through the shared error tracker.
- Dashboards: operator-web read-only views backed by `system_runs`, outbox, health, and incident truth.

## Alert Conditions

- Failed or cancelled `system_runs`.
- Dead-letter delivery rows.
- Delivery stalls.
- Stale worker heartbeat/activity.
- Open delivery circuit breakers.
- Stale ingestor freshness.

## Notes

- `apps/operator-web` remains read-only.
- No Supabase schema changes were required.
- UTV2-605 in Linear is already completed uniqueness-scoring work; this implementation closes the matching error-tracking/dashboard issue UTV2-603.
