# App: apps/api

The canonical write authority for the database. HTTP server (port 4000) handling submissions, settlement, grading, promotions, recaps, alerts, and operator interventions.

## Role in Unit Talk V2

- System layer: **API / orchestration**
- Runtime: HTTP server + scheduled tasks
- Maturity: production (26 test files, comprehensive error handling, graceful shutdown)

All writes to the database go through this server. No other app writes directly.

## Role in Dependency Graph

**Imports:** `@unit-talk/config`, `@unit-talk/contracts`, `@unit-talk/db`, `@unit-talk/domain`, `@unit-talk/observability`, `@unit-talk/events`, `@unit-talk/intelligence`, `@unit-talk/verification`

**Depended on by:** no packages (apps don't export to other apps)

**Called by:** `apps/command-center`, `apps/smart-form`, `apps/discord-bot`, `apps/ingestor`, `apps/worker` (via HTTP)

## What Lives Here

**Server:**
- `src/server.ts` — HTTP server, `routeRequest()`, `ApiRuntimeDependencies`, auth gate
- `src/auth.ts` — Bearer token auth middleware, role-based route authorization
- `src/http-utils.ts` — CORS, JSON response helpers

**Routes (9):**
- `routes/health.ts`, `routes/alerts.ts`, `routes/submissions.ts`, `routes/picks.ts`, `routes/grading.ts`, `routes/recap.ts`, `routes/member-tiers.ts`, `routes/reference-data.ts`

**Controllers (8):**
- `controllers/submit-pick-controller.ts`, `controllers/review-pick-controller.ts`, `controllers/settle-pick-controller.ts`, `controllers/retry-delivery-controller.ts`, `controllers/rerun-promotion-controller.ts`, `controllers/override-promotion-controller.ts`, `controllers/requeue-controller.ts`

**Services:**
- `submission-service.ts` — pick creation, idempotency, domain enrichment, atomic RPC path
- `promotion-service.ts` — 5-score evaluation, CLV trust adjustment, policy evaluation
- `distribution-service.ts` — outbox enqueue, target validation
- `settlement-service.ts` — settlement recording, corrections, atomic RPC path, CLV computation
- `grading-service.ts` — automated grading from game results
- `recap-service.ts` — daily/weekly recap generation + Discord posting
- `run-audit-service.ts` — distribution enqueue with run tracking, atomic path
- `alert-agent.ts` + `alert-agent-service.ts` — line movement detection
- `alert-notification-service.ts` — Discord webhook notifications
- `clv-service.ts` — closing line value computation
- `clv-feedback.ts` — CLV-based trust score adjustment
- `real-edge-service.ts` — model probability vs market probability
- `domain-analysis-service.ts` — domain enrichment at submission time
- `lifecycle-service.ts` — re-exports from `@unit-talk/db`
- `player-enrichment-service.ts` — player data enrichment (6h interval)
- `trial-expiry-service.ts` — trial membership expiration

**Scheduling (in index.ts):**
- Recap scheduler (continuous)
- Trial expiry scheduler
- Player enrichment (6h setInterval)

## Core Concepts

**Auth:** Bearer token API keys per role (operator, submitter, settler, poster, worker). Auth bypassed in `fail_open` mode when no keys configured.

**Fail-closed:** In `fail_closed` mode (production default), refuses to start without DB credentials. No silent in-memory fallback.

**Atomic operations:** Submission, enqueue, delivery confirm, and settlement use Postgres RPC for transactional safety. Falls back to sequential for InMemory mode.

**Promotion pipeline:** submission → domain analysis → real edge computation → 5-score evaluation → gate checks → enqueue to outbox.

## Runtime Behavior

- HTTP server on port 4000 (configurable)
- All POST routes require `Authorization: Bearer <key>` (when auth enabled)
- Rate limiting on `/api/submissions` (in-memory, per-process)
- Graceful shutdown on SIGINT/SIGTERM (5s timeout)
- Structured JSON logging via `@unit-talk/observability`

## Tests

26 test files covering: auth (16 tests), submission (55 tests), settlement (14 tests), server routes (18 tests), HTTP integration (17 tests), grading, promotion, alerts, CLV, recap, domain analysis, model registry, player enrichment, trial expiry, golden regression, T1 proof (20 DB-backed assertions).

## Rules

- This is the ONLY canonical DB writer — no other app writes directly
- All write endpoints must be auth-gated
- Audit logs must capture authenticated actor identity
- Lifecycle transitions must go through `transitionPickLifecycle()` or atomic RPCs
- Service functions receive repository bundles — they do not create DB clients

## What NOT to Do

- Do not add direct Supabase client calls in routes/controllers — use repositories
- Do not bypass auth middleware for new write endpoints
- Do not add write surfaces to other apps (operator-web, command-center, smart-form)
- Do not swallow errors on critical paths — fail closed

## Known Drift or Cautions

- `alert-agent` app imports directly from `apps/api/src/` — cross-app import violation
- 3 pre-existing test failures in `promotion-edge-integration.test.ts` on main
- Rate limiting is in-memory, per-process — not distributed across instances


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
