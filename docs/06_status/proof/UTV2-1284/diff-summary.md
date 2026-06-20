# UTV2-1284 — Diff Summary

**Lane:** Harden ingestor daemon — resilient poll loop, loop-progress healthcheck, bounded league re-admission
**Branch:** `griffadavi/utv2-1284-harden-ingestor-deploy-lifecycle-orphan-run-reaping-graceful`
**Tier:** T1
**Scope:** `apps/ingestor` + `deploy/production/docker-compose.yml`. No schema change, no migration.

## Problem (proven 2026-06-20)

A transient Supabase 521 outage made a cycle-level DB call
(`events.listStartedBySnapshot`, inside `runFinalizedRepollsForCycle`) throw. The
rejection escaped the infinite `runIngestorCycles` loop to the promise `.catch`,
which set `process.exitCode = 1` **without exiting**. The loop was dead but the
process lingered, and the container healthcheck `pgrep -f 'node'` reported "healthy"
— so Docker never restarted it. Production ingestion went dark ~5.5h.

## Change

### `apps/ingestor/src/ingestor-runner.ts`
- **FIX #1:** wrap the per-cycle body in try/catch; on failure emit
  `POLL ITERATION FAILED — daemon continuing to next poll (fail-closed, UTV2-1284)`
  and continue. The inter-cycle `sleep` moved outside the try so the loop always
  advances. Per-cycle heartbeat (`recordHeartbeat(cycle)`) stamped at the top of each
  iteration.
- **FIX #3:** `leagueInFlight` is now `Map<string, number>` (epoch-ms marked time).
  A league held past `leagueReadmitMs` (default 2× `leagueTimeoutMs`) is force-released
  and re-admitted with telemetry; releases are guarded so a re-admission can't be
  clobbered by a late `onWorkSettled`. New options: `recordHeartbeat`, `leagueReadmitMs`,
  `now` (injectable clock for tests).

### `apps/ingestor/src/heartbeat.ts` (new)
- Pure heartbeat read/write + `evaluateHeartbeatLiveness` + env resolvers.

### `apps/ingestor/src/healthcheck.ts` (new)
- Container healthcheck entry: reads the heartbeat file, exits 0 (fresh) / 1 (stale or
  missing). Exported `runHealthcheck` for tests.

### `apps/ingestor/src/index.ts`
- **FIX #2:** wire `recordIngestorHeartbeat` to a heartbeat file each cycle and start an
  in-process watchdog that `process.exit(1)`s on a stale heartbeat so
  `restart: unless-stopped` recreates the container. Pass `recordHeartbeat` +
  `leagueReadmitMs` to `runIngestorCycles`.

### `deploy/production/docker-compose.yml`
- Ingestor healthcheck `pgrep -f 'node'` → `tsx apps/ingestor/src/healthcheck.ts`;
  `start_period` 20s → 90s, `interval` 30s → 60s.

### Tests (new)
- `ingestor-loop-resilience.test.ts` — FIX #1 (transient DB failure does not kill the
  loop; heartbeat advances; heartbeat-hook throw non-fatal) + FIX #3 (timed-out league
  re-admitted past the bound).
- `heartbeat.test.ts` — healthcheck fails when stale even though the process is alive.

## Why this is correct & fail-closed

- A transient cycle-level error fails the **iteration** closed and the daemon keeps
  polling — no permanent loop death. The per-league isolation (UTV2-1282) is unchanged.
- Liveness now proves loop progress, not process existence; a wedged loop is restarted
  (watchdog `process.exit` + `unless-stopped`), removing the daemon-dead/process-alive
  state.
- A timed-out league can no longer be excluded from rotation indefinitely.
- Guardrails honored: ingestor still writes only provider/event tables; no scoring or
  freshness-gate change, no migration, no public-delivery change, no backfill.

## Files changed

| File | Type |
|---|---|
| `apps/ingestor/src/ingestor-runner.ts` | modified (fix #1 + #3) |
| `apps/ingestor/src/index.ts` | modified (fix #2 wiring + watchdog) |
| `apps/ingestor/src/heartbeat.ts` | new |
| `apps/ingestor/src/healthcheck.ts` | new |
| `apps/ingestor/src/heartbeat.test.ts` | new |
| `apps/ingestor/src/ingestor-loop-resilience.test.ts` | new |
| `deploy/production/docker-compose.yml` | modified (healthcheck) |
