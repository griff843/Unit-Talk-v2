# App: apps/alert-agent

Standalone daemon for line movement detection and notification routing. Runs detection + notification passes every 60 seconds.

## Role in Unit Talk V2

- System layer: **alerting / monitoring**
- Runtime: polling daemon (60s interval)
- Maturity: early/experimental

## Role in Dependency Graph

**Imports:** `@unit-talk/alert-runtime`, `@unit-talk/config`, `@unit-talk/db`, `@unit-talk/observability`

## What Lives Here

- `src/main.ts` — entry point, builds own repository bundle and starts the alert agent

Alert detection, notification, and hedge logic lives in `packages/alert-runtime/` (`@unit-talk/alert-runtime`). This app is a thin wrapper that starts the agent as a standalone process.

## Core Concepts

**Detection:** scans `provider_offers` for line movement by market type (spread, total, moneyline, player_prop). Tiered thresholds: watch → notable → alert-worthy.

**Notification:** Discord webhooks with cooldown per tier. Defaults to dry-run mode (`ALERT_DRY_RUN !== 'false'`).

**Hedge detection:** separate pass identifies arbitrage/middle/hedge opportunities across books.

## Runtime Behavior

- 60-second polling interval (hardcoded `ALERT_AGENT_INTERVAL_MS = 60_000`)
- Graceful shutdown on SIGINT/SIGTERM
- Dry-run mode by default — must set `ALERT_DRY_RUN=false` for live notifications

## Tests

None in this app. Alert logic is tested in `apps/api/src/alert-agent*.test.ts` (which re-exports from `@unit-talk/alert-runtime`).

## Rules

- This is a standalone process — not part of the API server
- Alert logic lives in `@unit-talk/alert-runtime` — do not move it back into app code
- Dry-run is the safe default — never enable live notifications without explicit configuration

## What NOT to Do

- Do not add write surfaces
- Do not add business logic here — keep it in the API alert services or move to a shared package
- Do not enable live Discord notifications without `ALERT_DRY_RUN=false`

## Known Drift or Cautions

- Alert thresholds are hardcoded in `alert-agent-service.ts` — not configurable via env vars
- `ALERT_DRY_RUN` defaults to `true` — operators may think alerts are broken when they're just disabled


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
