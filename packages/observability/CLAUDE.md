# Package: @unit-talk/observability

Structured JSON logging, Loki log shipping, metrics collection, and correlation ID management.

## Role in Unit Talk V2

- System layer: **observability / instrumentation**
- Pure: mostly (Loki writer makes HTTP calls, but logging itself is side-effect-free)
- Maturity: stable

## Role in Dependency Graph

**Imports:** none (Node.js built-ins only)

**Depended on by:** every app (`api`, `worker`, `ingestor`, `discord-bot`, `operator-web`, `alert-agent`)

## What Lives Here

- `src/index.ts` — all exports (525 lines): Logger, MetricsCollector, Loki writer, correlation IDs, error serialization

## Core Concepts

**Logger:** `createLogger(options)` returns `Logger` with `debug/info/warn/error` methods. Child loggers inherit parent context via `.child()`. Output is structured JSON to stdout/stderr.

**Loki integration:** `createLokiLogWriter()` batches log entries and pushes to Grafana Loki endpoint with `X-Scope-OrgID` support. `createDualLogWriter()` writes to both console and Loki with resilient fallback.

**Metrics:** `createMetricsCollector()` provides counters, gauges, histograms with label-based cardinality and configurable histogram buckets. Snapshot method for `/metrics` export.

**Correlation IDs:** `getOrCreateCorrelationId(headers)` normalizes and propagates request correlation across services (max 128 chars).

## Tests

- `src/index.test.ts` — 15+ tests covering logger creation, Loki writer, dual writer, correlation ID, error serialization, metrics counters/gauges/histograms

## Rules

- All apps must use `createLogger()` — no raw `console.log` in production code
- Correlation IDs must be propagated on all cross-service calls

## What NOT to Do

- Do not add business logic
- Do not import from `@unit-talk/db` or `@unit-talk/domain`


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
