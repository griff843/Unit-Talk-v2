# App: apps/discord-bot

Discord slash command bot. 9 commands, 2 event handlers, role-based authorization. Reads from API, does not write to DB.

## Role in Unit Talk V2

- System layer: **user interface / Discord**
- Runtime: event-driven (Discord.js client)
- Maturity: stable (9 commands, 1 test file at 60KB)

## Role in Dependency Graph

**Imports:** `discord.js`, `@unit-talk/config`, `@unit-talk/contracts`, `@unit-talk/events`, `@unit-talk/observability`

**Does NOT import:** `@unit-talk/db`, `@unit-talk/domain` — by design

## What Lives Here

- `src/main.ts` — entry point, config, handler registration
- `src/client.ts` — Discord.js client factory
- `src/command-registry.ts` — dynamic command loader from `./commands/`
- `src/router.ts` — interaction router
- `src/api-client.ts` — HTTP client for API callbacks
- `src/commands/` — 9 commands: alerts-setup, heat-signal, help, leaderboard, pick, recap, stats, trial-status, upgrade
- `src/handlers/` — capper-onboarding, member-tier-sync event handlers
- `src/embeds/` — Discord embed builders
- `src/scripts/` — deploy-commands, sync-manifest

## Core Concepts

**Command authorization:** `requiredRoles` field on each command handler. Role guard checks Discord roles before execution.

**API boundary:** bot calls API via HTTP for data (stats, leaderboard). Never reads from or writes to DB directly.

**Tier resolution:** maps Discord roles to member tiers for access control.

## Runtime Behavior

- Event-driven: listens to `ready`, `interactionCreate`, `guildMemberUpdate`
- Calls API for data retrieval
- Graceful shutdown on SIGTERM/SIGINT (destroys Discord client)

## Tests

- `discord-bot-foundation.test.ts` — comprehensive command/handler tests

## Rules

- Bot never writes to DB — reads via API only
- No duplicated business logic — scoring, promotion, settlement logic stays in API/domain
- Do not activate deferred channels (exclusive-insights, game-threads, strategy-room)
- Role IDs must be configured via env vars

## What NOT to Do

- Do not add direct database access
- Do not duplicate scoring or promotion logic from domain
- Do not create new Discord channels without a Linear issue
- Do not bypass role-based command authorization


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
