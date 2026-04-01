# Package: @unit-talk/config

Environment loading and workspace configuration. Three-layer env file merge with typed `AppEnv` interface.

## Role in Unit Talk V2

- System layer: **configuration**
- Pure: mostly (reads filesystem for env files, but no network I/O)
- Maturity: stable

## Role in Dependency Graph

**Imports:** none (Node.js built-ins only)

**Depended on by:** `@unit-talk/db`, `apps/api`, `apps/worker`, `apps/ingestor`, `apps/operator-web`, `apps/discord-bot`

## What Lives Here

- `src/index.ts` — re-exports + `workspaceConfig` constant
- `src/env.ts` — `AppEnv` interface (56 keys), `loadEnvironment()`, `requireSupabaseEnvironment()`, env file parser

## Core Concepts

**Three-layer merge:** `.env.example` → `.env` → `local.env`. Later files override earlier. Process env vars take absolute precedence.

**AppEnv interface:** typed keys for Linear, Notion, Slack, Supabase, SGO, Odds API, Discord, worker, API, ingestor, and operator config.

**Supabase guard:** `requireSupabaseEnvironment()` throws if `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` are missing.

## Tests

None.

## Rules

- All env var access should go through `loadEnvironment()` — do not read `process.env` directly in packages
- New env vars must be added to the `AppEnv` interface and `.env.example`

## What NOT to Do

- Do not add runtime logic (HTTP, DB, scheduling)
- Do not add app-specific config parsing (that belongs in the app)


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
