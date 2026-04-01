# App: apps/operator-web

Read-only operator dashboard. Server-side rendered HTML + JSON API endpoints consumed by Command Center.

## Role in Unit Talk V2

- System layer: **operator read surface**
- Runtime: Node HTTP server (port 4200)
- Maturity: stable (15 routes, 1 test file at 150KB)

No write surfaces. All mutations go through `apps/api`.

## Role in Dependency Graph

**Imports:** `@unit-talk/config`, `@unit-talk/contracts`, `@unit-talk/db`, `@unit-talk/domain`, `@unit-talk/observability`

**Consumed by:** `apps/command-center` (fetches JSON data)

## What Lives Here

- `src/index.ts` — entry point, starts HTTP server on port 4200
- `src/server.ts` — HTTP handler, 15 routes
- `src/routes/` — health, snapshot, picks-pipeline, recap, stats, leaderboard, capper-recap, participants, dashboard, pick-detail, review-queue, held-queue, pick-search, review-history, performance, intelligence, exception-queues
- `src/http-utils.ts` — CORS, JSON helpers

## Runtime Behavior

- HTTP server on port 4200
- All routes are GET (read-only)
- Data served on-demand from database
- `OUTBOX_HISTORY_CUTOFF` filters historical noise (2026-03-20)
- No polling, no caching, no real-time subscriptions

## Tests

- `server.test.ts` — comprehensive route-level tests

## Rules

- Read-only — no write endpoints, no mutations
- Data goes through `@unit-talk/db` repositories — no raw Supabase queries
- JSON API format consumed by Command Center

## What NOT to Do

- Do not add write surfaces (POST/PUT/DELETE endpoints)
- Do not add authentication (it's an internal-only surface)
- Do not duplicate business logic from API services


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
