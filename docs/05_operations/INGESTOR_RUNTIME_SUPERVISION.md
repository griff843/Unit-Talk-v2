# Ingestor Runtime Supervision

## Purpose

The ingestor is a live polling process. If it is not running, provider polling and results-driven settlement stop.

This repo now provides a bounded supervision path so operators can run the ingestor as a managed local/runtime service instead of a fragile foreground shell.

This supervisor path is now the canonical operator method. Do not use ad hoc unmanaged `tsx apps/ingestor/src/index.ts` shells as the normal runtime path.

## Commands

Run from the repo root:

```bash
pnpm ingestor:start
pnpm ingestor:status
pnpm ingestor:stop
pnpm ingestor:restart
```

## Runtime shape

- `pnpm ingestor:start` launches a detached supervisor process
- the supervisor starts the real ingestor child
- if the child exits unexpectedly, the supervisor restarts it with capped backoff
- runtime state and logs are written under `out/ingestor-runtime/`

Files written there:

- `out/ingestor-runtime/state.json`
- `out/ingestor-runtime/supervisor.log`
- `out/ingestor-runtime/ingestor.log`

## Required env

Recommended runtime values:

```env
UNIT_TALK_INGESTOR_AUTORUN=true
UNIT_TALK_INGESTOR_MAX_CYCLES=0
UNIT_TALK_INGESTOR_POLL_MS=300000
```

`MAX_CYCLES=0` means the ingestor child runs indefinitely until the supervisor stops or restarts it.

## How to verify

Use:

```bash
pnpm ingestor:status
```

Status reports:

- whether the supervisor is running
- whether the ingestor child is running
- latest `ingestor.cycle` status/time from `system_runs`
- latest `provider_offers.created_at` freshness
- health verdict: `healthy`, `degraded`, or `down`

Healthy runtime means:

- supervisor running
- ingestor child running
- recent `ingestor.cycle` activity
- fresh provider offers

## Failure and restart behavior

If the ingestor child crashes:

- the supervisor records the exit in `state.json`
- restart count increments
- restart backoff is applied
- the child is started again automatically

If the operator stops the supervisor:

- the supervisor sends `SIGTERM` to the child
- both processes exit cleanly

## Operational note

The supervisor refuses to start if it detects unmanaged ingestor processes already running. Stop those first so polling is not duplicated.
