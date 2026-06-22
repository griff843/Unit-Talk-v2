# UTV2-1288 — Diff Summary

**Lane:** UTV2-1288 — harden ingestor startup chain against transient Supabase outages
**Tier:** T1 · **Lane type:** runtime · **Merge status:** HELD pending Supabase-stable runtime proof

## Files changed

| File | Change | Purpose |
|---|---|---|
| `apps/ingestor/src/startup-resilience.ts` | added | Pure-function `runStartupStepWithRetry` (bounded exponential backoff, never throws, returns `{ok,value,attempts,error}`) + `startupBackoffDelayMs`. |
| `apps/ingestor/src/startup-resilience.test.ts` | added | 6 deterministic offline tests (injected sleep, no DB): never-throws, transient recovery, first-attempt success, onRetry backoff metadata, exponential cap, maxAttempts clamp. |
| `apps/ingestor/src/index.ts` | modified | Wrap the pre-loop startup chain (SGO-key resolution + `reapStaleRuns`) in the resilient runner; defensive try/catch around SGO-key resolution; startup-phase `recordIngestorProgress` heartbeats (`startup:sgo-key`, `startup:reap-stale-runs`, `:retry`, `startup:complete`); preserve last-resort fail-closed exit for genuine `runIngestorCycles` errors. |
| `docs/06_status/proof/UTV2-1288/*` | added | Proof bundle (this summary, verification.md, evidence.json). |

## Root cause → fix

- **Before:** bare promise chain; only failure handler set `process.exitCode=1`. Transient Supabase outage → `reapStaleRuns` throws → exit → `restart: unless-stopped` recreates instantly → crash-loop (`RestartCount=109`/~10h, 3 watchdog exits).
- **After:** startup steps log + mark telemetry (`STARTUP_SGO_KEY_FAILED`, `STARTUP_REAP_RETRY`, `STARTUP_REAP_FAILED`) + continue into the already-resilient cycle loop; bounded retry/backoff for `reapStaleRuns`; startup heartbeats keep watchdog progress advancing during retries.

## Guardrail compliance

No Discord enablement, no auto-approval, no P3 certification, no loosened thresholds, no secrets, watchdog/healthcheck preserved. No CLV/ROI/edge claims. No fabricated runtime evidence — live `test:db` is explicitly pending.
