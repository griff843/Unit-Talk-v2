# App: apps/ingestor

SGO and Odds API feed ingestion. Polls external providers, normalizes odds/results, stores to database.

## Role in Unit Talk V2

- System layer: **ingestion / data pipeline**
- Runtime: polling daemon
- Maturity: production (circuit breaker, entity resolution, 2 test files, 50+ tests)

## Role in Dependency Graph

**Imports:** `@unit-talk/config`, `@unit-talk/contracts`, `@unit-talk/db`, `@unit-talk/observability`

## What Lives Here

- `src/index.ts` — entry point, runtime setup, fail-closed guard
- `src/ingestor-runner.ts` — main cycle orchestrator, provider dispatch
- `src/sgo-fetcher.ts` — SGO API client
- `src/odds-api-fetcher.ts` — Odds API client (Pinnacle, DK, FD, MGM)
- `src/ingest-league.ts` — per-league ingestion logic
- `src/entity-resolver.ts` — player/team entity mapping
- `src/sgo-normalizer.ts` — normalize SGO offers to `NormalizedProviderOffer`
- `src/circuit-breaker.ts` — per-provider failure tracking
- `src/historical-backfill.ts` — backfill historical data

## Core Concepts

**Two providers:** SGO (primary odds/props) and Odds API (Pinnacle + multi-book consensus). Both gated by API key env vars.

**Supported leagues:** `['NBA', 'NFL', 'MLB', 'NHL']` (hardcoded, configurable via `UNIT_TALK_INGESTOR_LEAGUES`).

**Entity resolution:** maps external player/team names to canonical `participants` records. Creates participants on first encounter.

**Fail-closed:** in production (`APP_ENV !== 'local'`), refuses to start without DB credentials. No silent in-memory fallback.

**Results ingestion:** optional (`UNIT_TALK_INGESTOR_SKIP_RESULTS`). Triggers grading pass via POST to `/api/grading/run` after each cycle.

## Runtime Behavior

- Polls on configurable interval (default 300s)
- Max cycles per run configurable (default 1)
- Autorun controlled by `UNIT_TALK_INGESTOR_AUTORUN`
- Circuit breaker per fetch (in-memory, per-process)
- Summary output includes persistenceMode and runtimeMode

## Tests

- `ingestor.test.ts` — 27 tests covering: league ingestion, entity resolution, results ingestion, historical backfill, reference data search
- `circuit-breaker.test.ts` — failure tracking and reset

## Rules

- Ingestor writes to `provider_offers`, `game_results`, `events`, `event_participants`, `participants` only
- Does not write to `picks`, `submissions`, `settlement_records`, or `distribution_outbox`
- Entity resolution must be idempotent (upsert by external ID)
- Grading trigger is fire-and-forget (failure logged, non-fatal)

## What NOT to Do

- Do not add business logic (scoring, promotion)
- Do not write to pick/submission/settlement tables
- Do not add new sports without updating entity resolver and SGO normalizer
- Do not bypass fail-closed guard in production

## Known Drift or Cautions

- SGO league list is hardcoded in `ingestor-runner.ts` — adding new sports requires code change
- Alert detection thresholds in `alert-agent-service.ts` are hardcoded — not configurable via env


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
