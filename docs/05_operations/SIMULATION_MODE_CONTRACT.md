# Simulation Mode Contract

**Status:** Ratified 2026-03-31
**Issue:** UTV2-156
**Authority:** Architecture — delivery pipeline behavior contract

---

## Purpose

Provide a system-wide simulation mode that runs the full promotion -> distribution -> delivery pipeline but suppresses actual Discord posts, writing simulation receipts instead. This enables safe validation of new distribution targets before live activation.

## Activation

- Env var: `UNIT_TALK_SIMULATION_MODE=true`
- Default: `false` (live mode)
- Kill switch: env var only — no DB config, no runtime toggle
- When active, the worker uses a simulation delivery adapter instead of the live Discord adapter

## Behavior

### What stays the same in simulation mode

- Promotion evaluation runs normally (all scoring, policy checks, threshold gates)
- Outbox rows are written normally (same `distribution_outbox` table, same statuses)
- Lifecycle transitions proceed (`validated` -> `queued`)
- Audit log entries are written

### What changes in simulation mode

- The delivery adapter returns **simulation receipts** instead of calling the Discord API
- Receipt `receiptType` = `'worker.simulation'`
- Receipt `channel` = `simulated:<target>` (e.g., `simulated:discord:best-bets`)
- Receipt `status` = `'sent'` (simulation always succeeds)
- Receipt `payload.simulated` = `true`
- Outbox rows transition to `sent` (pipeline completes normally)
- Lifecycle transitions to `posted` proceed (pick appears posted from the system's perspective)

### Operator snapshot

- `simulationMode: boolean` — top-level flag in snapshot
- `counts.simulatedDeliveries` — count of receipts with `receiptType = 'worker.simulation'`
- Simulated deliveries are excluded from real delivery counts (`counts.sentOutbox` counts only non-simulated)
- Dashboard HTML shows a visible banner when simulation mode is active

## Implementation Scope

### Allowed files

- `apps/worker/src/runtime.ts` — add `readSimulationMode()` reader
- `apps/worker/src/delivery-adapters.ts` — add `createSimulationDeliveryAdapter()`
- `apps/worker/src/index.ts` — wire simulation mode to adapter selection
- `apps/worker/src/runner.ts` — pass simulation flag if needed
- `apps/operator-web/src/server.ts` — add `simulationMode` flag and `simulatedDeliveries` count
- `apps/operator-web/src/routes/dashboard.ts` — banner for simulation mode
- `apps/worker/src/worker-runtime.test.ts` — tests for simulation adapter
- `apps/operator-web/src/server.test.ts` — tests for simulation count separation

### Forbidden files

- `apps/api/src/*` — simulation does not change API behavior
- `packages/*` — no contract/domain changes
- `apps/discord-bot/*` — bot is unaffected
- `apps/ingestor/*` — ingestor is unaffected

## Relationship to existing dryRun

The existing `UNIT_TALK_WORKER_DRY_RUN` flag controls whether the Discord adapter makes real HTTP calls. Simulation mode is a higher-level concept:

| | dryRun=true | simulationMode=true |
|---|---|---|
| Receipt type | `worker.dry-run` | `worker.simulation` |
| Channel field | target as-is | `simulated:<target>` |
| Operator counting | counted as real | counted separately |
| Purpose | dev/test safety | pre-activation validation |
| Lifecycle effect | pick transitions to posted | pick transitions to posted |

Both can be active simultaneously. If both are set, simulation mode takes precedence (simulation adapter is used).

## Verification

- `pnpm type-check` passes
- `pnpm test` passes
- New tests:
  - Simulation adapter returns correct receipt shape
  - Simulation receipts have `simulated:<target>` channel format
  - Operator snapshot separates simulated vs real delivery counts
  - Simulation mode flag appears in snapshot when active

## Rollback

Remove `UNIT_TALK_SIMULATION_MODE` env var. System reverts to live delivery. No data migration needed — simulation receipts remain in `distribution_receipts` as historical records.
