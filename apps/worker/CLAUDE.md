# App: apps/worker

Outbox drain worker. Polls `distribution_outbox`, claims rows, delivers picks to Discord (or simulation targets), records receipts.

## Role in Unit Talk V2

- System layer: **delivery / worker**
- Runtime: long-running polling daemon
- Maturity: production (circuit breaker, delivery adapters, simulation mode, 41 tests)

## Role in Dependency Graph

**Imports:** `@unit-talk/config`, `@unit-talk/contracts`, `@unit-talk/db`, `@unit-talk/domain`, `@unit-talk/observability`, `@unit-talk/events`, `@unit-talk/intelligence`

## What Lives Here

- `src/index.ts` — entry point, adapter selection, autorun control
- `src/runner.ts` — main cycle loop (claim → deliver → record → heartbeat)
- `src/runtime.ts` — runtime configuration builder
- `src/distribution-worker.ts` — core delivery logic, lifecycle transitions, atomic confirm
- `src/delivery-adapters.ts` — Discord HTTP adapter, simulation adapter, dry-run mode
- `src/circuit-breaker.ts` — per-target failure tracking with cooldown

## Core Concepts

**Outbox pattern:** worker polls `distribution_outbox` for pending rows, claims one per cycle via atomic `claimNextAtomic` (SELECT FOR UPDATE SKIP LOCKED), delivers, confirms atomically.

**Delivery adapters:** real Discord (HTTP POST to channel), simulation (returns mock receipt), dry-run (logs only). Selected via `UNIT_TALK_WORKER_ADAPTER` env var.

**Circuit breaker:** 5 consecutive failures opens circuit for 5 minutes. In-memory only (resets on restart). Per-target isolation.

**Atomic confirm:** `confirmDeliveryAtomic` RPC wraps markSent + lifecycle transition + receipt + audit in single Postgres transaction. Prevents double-post after crash.

**Stale claim reaper:** releases rows stuck in `processing` for >5 minutes back to `pending`.

## Runtime Behavior

- Polls on configurable interval (default from env)
- Autorun controlled by `UNIT_TALK_WORKER_AUTORUN`
- Heartbeat touches claim every 5s to prevent stale reaping
- Watchdog timer (30s default) kills hung deliveries
- Graceful shutdown on SIGINT/SIGTERM

## Tests

- `worker-runtime.test.ts` — 41 tests covering: delivery success/failure, dead-lettering, circuit breaker, rollout controls, heartbeat, simulation adapter, worker cycles

## Rules

- Worker = delivery only — no business logic, no scoring, no promotion
- Every delivery produces exactly one `DeliveryOutcome` (sent | retryable-failure | terminal-failure)
- No swallowed errors — all failures must produce an outcome
- Use atomic claim and confirm when on Database persistence
- Circuit breaker per target — never hammer a down service

## What NOT to Do

- Do not add business logic (scoring, promotion evaluation) to the worker
- Do not bypass the circuit breaker
- Do not deliver to deferred channels (exclusive-insights, game-threads, strategy-room)
- Do not call Discord API outside of delivery adapters

## Known Drift or Cautions

- Circuit breaker state is in-memory only — resets on worker restart, allowing a burst of requests to a down service
- `claimNext()` (non-atomic) still exists as fallback — has SELECT-then-UPDATE race window


---

## System Invariants (inherited from root CLAUDE.md)

**Test runner:** `node:test` + `tsx --test` + `node:assert/strict`. NOT Jest. NOT Vitest. NOT `describe/it/expect` from Jest. Assertion style: `assert.equal()`, `assert.deepEqual()`, `assert.ok()`, `assert.throws()`.

**Module system:** ESM (`"type": "module"`) — use `import`/`export`, not `require`/`module.exports`. File extensions in imports use `.js` (TypeScript resolution).

**Schema invariants (never get these wrong):**
- `picks.status` = lifecycle column (NOT `lifecycle_state`)
- `pick_lifecycle` = events table (NOT `pick_lifecycle_events`)
- `audit_log.entity_id` = FK to primary entity (NOT pick id)
- `audit_log.entity_ref` = pick id as text
- `submission_events.event_name` (NOT `event_type`)
- `settlement_records.corrects_id` = correction FK; original row is never mutated

**Data sources:** SGO API (`SGO_API_KEY`) and The Odds API (`ODDS_API_KEY`) via `apps/ingestor`. Both OpenAI and Anthropic Claude are in use in `packages/intelligence` and `apps/alert-agent`.

**Legacy boundary:** `C:\dev\unit-talk-production` is reference-only. No implicit truth import from legacy behavior. Any reused behavior must have a v2 artifact or runtime proof.

**Verification gate:** `pnpm verify` runs env:check + lint + type-check + build + test. Use `pnpm test` for unit tests, `pnpm test:db` for live DB smoke tests.
