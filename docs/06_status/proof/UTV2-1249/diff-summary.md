# UTV2-1249 Diff Summary

Generated: 2026-06-11T03:26:07Z

## Summary

- Updated `scripts/pipeline-health.ts` so proof-blocked governance-brake dead-letter rows remain visible as warnings but are excluded from true delivery-failure, queue-health, and SLO delivery-success counts.
- Updated `scripts/runtime-health.ts` so queue movement treats proof-blocked governance-brake rows as degraded context rather than failed delivery rows, while true dead letters still fail the subsystem.
- Updated `scripts/runtime-health.ts` so UNKNOWN subsystem evidence degrades overall runtime health instead of returning a misleading HEALTHY aggregate.
- Added focused `node:test` coverage in `scripts/ops/canonical-health.test.ts` for governance-brake classification, true dead-letter failure classification, and UNKNOWN aggregate behavior.

## Files Changed

- `scripts/pipeline-health.ts`
  - Classifies `dead_letter` outbox rows with `attempt_count = 0` and `last_error` prefixed by `proof-pick-blocked:` as expected P7A governance-brake rows.
  - Feeds only non-governance-brake rows into `evaluateQueueHealth()` and `evaluateSlo()`, preserving true delivery-failure fail-closed behavior.

- `scripts/runtime-health.ts`
  - Selects `last_error` for outbox rows and applies the same governance-brake classification in the queue movement subsystem.
  - Reports true dead letters separately from governance-brake rows.
  - Adds UNKNOWN subsystem aggregation into the degraded list before computing overall state.

- `scripts/ops/canonical-health.test.ts`
  - Adds regression tests for runtime queue classification and UNKNOWN overall degradation.

## Runtime Evidence

Focused live `pipeline:health` JSON evidence from `/tmp/utv2-1249-pipeline-health.json`:

```json
{
  "checked_at": "2026-06-11T03:16:15.355Z",
  "outbox_dead_letter_count": 0,
  "outbox_governance_brake_count": 193,
  "outbox_failed_count": 0,
  "outbox_stuck_processing": 0,
  "queue_health_status": "healthy",
  "silent_stranding_risk": false,
  "last_successful_delivery_at": "2026-06-06T15:20:40.510112+00:00",
  "last_successful_delivery_age_ms": 388534845,
  "slo_overall_status": "breached",
  "slo_deploy_risk": "high",
  "slo_violated_objectives": ["delivery_freshness"],
  "criticals": [],
  "warns": [
    "193 governance brake row(s) (P7A, proof-pick-blocked - expected, not system failures)"
  ],
  "has_anomaly": false
}
```

Focused runtime UNKNOWN proof from `/tmp/utv2-1249-runtime-health-unknown-proof.json`:

```json
{
  "timestamp": "2026-06-11T03:17:53.932Z",
  "state": "DEGRADED",
  "failed": [],
  "unknownSubsystems": [
    "Worker Supervision",
    "Queue Movement",
    "Provider Freshness",
    "Scheduler Safety",
    "Discord Delivery",
    "API Activity"
  ]
}
```

## Scope

Changed files are within the allowed execution packet scope:

```text
scripts/ops/canonical-health.test.ts
scripts/pipeline-health.ts
scripts/runtime-health.ts
docs/06_status/proof/UTV2-1249/diff-summary.md
docs/06_status/proof/UTV2-1249/verification.md
```

## Root-cause fix (Claude rescue pass, 2026-06-11)

The original symptom — `delivery_freshness BREACHED, last delivery 5187m ago` while live DB
showed recent sent rows — was caused by an **unbounded Supabase select silently capped at
1000 rows**: with >1000 outbox rows the newest `sent` rows fell outside the result set, so
`newestSentTimestamp()` computed freshness from a stale subset (it read 2026-06-06T15:20Z).

`scripts/pipeline-health.ts` changes:

- Main outbox query now fetches **non-sent rows only**, ordered, with explicit limit.
- `last_successful_delivery_at` fetched exactly (newest sent row, dedicated query) and passed
  as `lastSuccessfulDeliveryAt` to `evaluateQueueHealth` (supported override).
- Sent count fetched via `count: 'exact', head: true` (display truth — was capped at 807, actual 1422+).
- "Last 5 sent" section fetched exactly instead of filtered from the capped set.

Governance classification extended (both `pipeline-health.ts` and `runtime-health.ts`):
`operator-disposition*` and `stale_pending_operator_review` (PM Decision D1, UTV2-1238)
dead-letters now classify as governance-class, not true delivery failures.
