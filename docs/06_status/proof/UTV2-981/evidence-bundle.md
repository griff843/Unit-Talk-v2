# UTV2-981 Runtime Health Baseline Evidence

Captured: 2026-05-18 04:14 UTC
Branch requested: `codex/utv2-981-runtime-health-baseline`

## Summary

- `pnpm api:status`: exits 0 and reports API supervisor/child DOWN with unreachable health endpoint.
- `pnpm worker:status`: exits 0 and reports worker supervisor/child DOWN with current heartbeat and no pending outbox rows.
- `pnpm ingestor:status`: exits 0 and reports Docker unavailable in this sandbox, ingestor supervisor/child DOWN, latest run failed, and stale provider offer timestamp.
- `pnpm runtime:health`: exits 1 and correctly reports runtime FAILED due to 9 dead-letter rows and stale provider offers.
- `pnpm pipeline:health`: exits 1 and correctly reports SLO breach, 9 dead-letter rows, delivery freshness breach, and degraded worker verdict.
- `pnpm stage:freshness`: exits 1 and correctly reports DEGRADED due to stale offers, outbox, and receipts.
- `pnpm readiness:report`: exits 1 and correctly reports NOT READY with worker idle, dead-letter outbox rows, and stale ingestor offers.

## Command Output

### pnpm api:status

Exit code: 0

```text
Supervisor:  DOWN
Child:       DOWN
Health:      DOWN - Health endpoint unreachable: fetch failed
HTTP:        n/a
Restarts:    6
Port:        4000
Runtime:     C:\Dev\Unit-Talk-v2-main\out\api-runtime
Logs:        C:\Dev\Unit-Talk-v2-main\out\api-runtime\supervisor.log
Child log:   C:\Dev\Unit-Talk-v2-main\out\api-runtime\api.log
```

### pnpm worker:status

Exit code: 0

```text
Supervisor:  DOWN
Child:       DOWN
Verdict:     DOWN
Restarts:    6
Last hb:     2026-05-18T04:11:30.318435+00:00 (0m ago)
Pending:     0 outbox rows
Runtime:     C:\Dev\Unit-Talk-v2-main\out\worker-runtime
Logs:        C:\Dev\Unit-Talk-v2-main\out\worker-runtime\supervisor.log
Child log:   C:\Dev\Unit-Talk-v2-main\out\worker-runtime\worker.log
```

### pnpm ingestor:status

Exit code: 0

```text
Docker:     DOWN (no ingestor container from docker ps)
Docker at:  none
Docker ps:
spawnSync docker EPERM
Supervisor: DOWN
Child:      DOWN
Health:     DOWN - Supervisor is not running.
Restarts:   7
Run status: failed
Run at:     2026-05-18T01:14:19.878002+00:00
Offer at:   2026-04-29T13:04:29.674+00:00
Runtime:    C:\Dev\Unit-Talk-v2-main\out\ingestor-runtime
Logs:       C:\Dev\Unit-Talk-v2-main\out\ingestor-runtime\supervisor.log
Child log:  C:\Dev\Unit-Talk-v2-main\out\ingestor-runtime\ingestor.log
  * Use the repo supervisor start command to keep ingestor alive.
```

### pnpm runtime:health

Exit code: 1

```text
RUNTIME: FAILED - 2 subsystem(s) down
FAILED:
  Queue: 9 dead_letter rows
  Provider: stale 26827m ago (>360m threshold)
DEGRADED:
  Worker: 9 failed runs in last 10
  Delivery: no delivery in 10.9h (>4h warn)
```

### pnpm pipeline:health

Exit code: 1

```text
OUTBOX QUEUE STATE
  sent         413
  dead_letter  9

Worker verdict: DEGRADED - last run failed
Overall SLO: BREACHED | Deploy risk: HIGH
Violated objectives: delivery_freshness, delivery_success, queue_availability
CRITICAL:
  9 dead_letter rows
  9 dead-letter row(s) require operator review
WARN:
  DEGRADED - last run failed
```

### pnpm stage:freshness

Exit code: 1

```text
Stage Freshness Report - 2026-05-18T04:11:47.139Z
[!] Offers             STALE  age=26827m
[OK] Market Universe    FRESH  age=5m
[OK] Candidates         FRESH  age=16m
[OK] Scoring            FRESH  age=92m
[OK] Board              FRESH  age=217m
[OK] Picks              FRESH  age=22m
[!] Outbox             STALE  age=1181m
[!] Receipts           STALE  age=654m
Verdict: DEGRADED (5 FRESH, 3 STALE, 0 EMPTY - verdict: DEGRADED)
```

### pnpm readiness:report

Exit code: 1

```text
readiness:report - 2026-05-18 04:14
[FAIL] Worker Runtime         last run 10.8h ago (failed)
[FAIL] Outbox Health          0 pending, 9 dead_letter
[FAIL] Ingestor Freshness     latest offer 447.2h ago
[OK] Identity Health          participant_id=83%, capper_id=0%
[OK] Settlement Coverage      99% settled picks have settlement_record
[OK] CLV Resolution           77% settlements have CLV data
[OK] Delivery Receipts        100 receipts across 4 channels
VERDICT: NOT READY - 3 critical issue(s)
  [FAIL] Worker idle 650min (>120min threshold)
  [FAIL] 9 outbox rows in dead_letter
  [FAIL] Ingestor stale: latest offer 26830min ago
```

## Actionable Blockers

- Runtime process supervisors for API, worker, and ingestor are down.
- Ingestor Docker inspection is unavailable in this sandbox: `spawnSync docker EPERM`.
- Provider offers are stale; latest observed snapshot is `2026-04-29T13:04:29.674+00:00`.
- Distribution outbox has 9 `dead_letter` rows requiring operator review.
- Latest distribution run failed and last successful delivery is stale.
