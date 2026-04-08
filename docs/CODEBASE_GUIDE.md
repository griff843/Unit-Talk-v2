# Unit Talk V2 — Codebase Guide

Technical reference for the Unit Talk V2 monorepo. This document covers architecture, packages, conventions, and build/run commands as confirmed from actual source files. The execution and governance instructions live in the root `CLAUDE.md`.

---

## What Unit Talk V2 Is

Unit Talk V2 is a sports-betting pick management system. It accepts bet picks from users (via web form, Discord, or API), evaluates them for quality using a multi-score promotion pipeline, routes qualified picks to Discord channels, grades settled bets against game results, and provides an operator dashboard for interventions. [CONFIRMED — from CLAUDE.md, package.json scripts, app CLAUDE.md files]

---

## Monorepo Structure

**Package manager:** pnpm 10.29.3 with workspaces [CONFIRMED — package.json `packageManager`]
**Build system:** TypeScript project references (`tsc -b`) [CONFIRMED — tsconfig.json, package.json `build` script]
**Workspace file:** `pnpm-workspace.yaml` [CONFIRMED — root directory listing]

```
apps/
  api/             The only canonical DB writer. Node HTTP server, port 4000.
  worker/          Outbox drain daemon. Polls distribution_outbox, delivers to Discord.
  operator-web/    Read-only operator dashboard. Node HTTP server, port 4200.
  discord-bot/     Discord slash command bot (9 commands). Reads via API, no direct DB.
  smart-form/      Browser pick intake form. Next.js, port 4100.
  alert-agent/     Line movement detection daemon. Thin wrapper around API alert services.
  ingestor/        SGO + Odds API feed ingestion. Polling daemon for provider_offers/game_results.
  command-center/  Operator intelligence dashboard. Next.js, port 4300.

packages/
  contracts/       Pure types and domain contracts. No runtime deps. Zero I/O.
  domain/          Pure business logic. Scoring, probability, lifecycle, detection. No DB, no HTTP.
  db/              Supabase client, repository interfaces and implementations, pick FSM.
  config/          Env file loader. Three-layer merge (local.env > .env > .env.example).
  observability/   Structured JSON logging, Loki shipping, metrics, correlation IDs.
  events/          DomainEvent<T> type contract. Stub — single interface.
  intelligence/    IntelligenceEnvelope type contract. Stub — single interface.
  verification/    Shadow mode, fault injection, replay, run history. R1-R5 architecture.
```

---

## Package Dependency DAG

[CONFIRMED — from each package.json `dependencies` field]

```
@unit-talk/contracts    (leaf — no internal deps)
       ↑
@unit-talk/domain       (imports contracts only)
       ↑
@unit-talk/db           (imports contracts, config)
       ↑
apps/* (import packages; never import from each other)
```

Supporting packages imported by apps:
- `@unit-talk/config` — used by api, worker, ingestor, operator-web, discord-bot
- `@unit-talk/observability` — used by all apps including alert-agent
- `@unit-talk/events` — used by api, worker, discord-bot
- `@unit-talk/intelligence` — used by api, worker
- `@unit-talk/verification` — used by api

Cross-app imports are prohibited. [CONFIRMED — AGENTS.md, app CLAUDE.md files. Note: alert-agent currently violates this with direct imports from apps/api/src/]

---

## Tech Stack

| Concern | Technology | Confirmed From |
|---|---|---|
| Language | TypeScript 5.9 | root package.json devDependencies |
| Module system | ESM (`"type": "module"`) | every package.json |
| Node.js target | ES2022 | tsconfig.base.json `target` |
| Module resolution | NodeNext | tsconfig.base.json `moduleResolution` |
| Package manager | pnpm 10.29.3 | root package.json `packageManager` |
| Test runner | `node:test` + `tsx --test` | AGENTS.md, root package.json test scripts |
| Assertions | `node:assert/strict` | AGENTS.md |
| Build | `tsc -b` (project references) | tsconfig.json, package.json `build` |
| Database | Supabase (PostgreSQL) via `@supabase/supabase-js` ^2.56.0 | packages/db/package.json |
| Discord | discord.js ^14.25.1 | apps/discord-bot/package.json |
| Frontend (smart-form) | Next.js 14.2.35, React 18.3.1 | apps/smart-form/package.json |
| Frontend (command-center) | Next.js 14.2.29, React 18.3.1 | apps/command-center/package.json |
| Styling | Tailwind CSS 3.x, Radix UI primitives | apps/smart-form/package.json |
| Forms | react-hook-form, Zod 3.x | apps/smart-form/package.json |
| Linting | ESLint 9.x, typescript-eslint 8.x | root package.json devDependencies |
| Formatting | Prettier 3.5 | root package.json devDependencies |
| Script runner | tsx 4.x | root package.json devDependencies |
| Logging | Custom JSON logger (`@unit-talk/observability`) + optional Loki | packages/observability/CLAUDE.md |
| Scheduling | pg_cron (Postgres) for nightly retention | migration 202604080016 |

**No Jest. No Vitest.** Tests use `node:test` natively. [CONFIRMED — AGENTS.md, all test scripts in package.json]

---

## Module System

All packages and apps use ESM: `"type": "module"` is set in every `package.json`. [CONFIRMED]

Import rules:
- Use `import`/`export` syntax — never `require`/`module.exports`
- File extensions in TypeScript import paths use `.js` (TypeScript NodeNext resolution resolves these to `.ts` at compile time)
- Example: `import { foo } from './bar.js'` where `bar.ts` is the actual file

---

## TypeScript Configuration

`tsconfig.base.json` (shared compiler options): [CONFIRMED — read directly]
- `target`: ES2022
- `module`: NodeNext
- `moduleResolution`: NodeNext
- `strict`: true
- `noUncheckedIndexedAccess`: true
- `exactOptionalPropertyTypes`: true
- `declaration`, `declarationMap`, `sourceMap`: true

`tsconfig.json` (root): project references build listing all packages and apps. [CONFIRMED]

Each package and app has its own `tsconfig.json` with a `references` array pointing to its internal dependencies.

---

## Database Layer

**Database:** Supabase (PostgreSQL), project ref `feownrheeefbcsehtsiw` [CONFIRMED — AGENTS.md, .env.example]

**Schema managed via migrations in `supabase/migrations/`** [CONFIRMED — directory listing showing 26+ migration files from 2026-03-20 onward]

**Generated types:** `packages/db/src/database.types.ts` — generated by `pnpm supabase:types`. Never hand-edit. [CONFIRMED — AGENTS.md, packages/db/CLAUDE.md]

**Repository pattern:** every table has an interface + two implementations: [CONFIRMED — packages/db/CLAUDE.md]
- `InMemory*Repository` — for unit tests, no live DB required, uses Maps/arrays
- `Database*Repository` — production, calls Supabase PostgREST

**Atomic RPCs (Postgres stored procedures called via `.rpc()`):** [CONFIRMED — packages/db/CLAUDE.md]
- `processSubmissionAtomic`
- `enqueueDistributionAtomic`
- `claimNextAtomic` (SELECT FOR UPDATE SKIP LOCKED)
- `confirmDeliveryAtomic`
- `settlePickAtomic`

**Key canonical tables** (41 total, from `packages/db/src/index.ts`): [CONFIRMED]
`submissions`, `picks`, `pick_lifecycle`, `pick_promotion_history`, `distribution_outbox`, `distribution_receipts`, `settlement_records`, `audit_log`, `provider_offers`, `game_results`, `alert_detections`, `hedge_opportunities`, `member_tiers`, `model_registry`

**Critical schema facts** (wrong field names break everything): [CONFIRMED — AGENTS.md]
- `picks.status` = lifecycle field (NOT `lifecycle_state`)
- `pick_lifecycle` = event table (NOT `pick_lifecycle_events`)
- `audit_log.entity_id` = FK to primary entity (NOT the pick id)
- `audit_log.entity_ref` = pick id stored as text
- `submission_events.event_name` (NOT `event_type`)
- `settlement_records.corrects_id` = correction FK; original rows are never mutated; audit_log is append-only

**Pick lifecycle FSM:** `validated → queued → posted → settled` (terminal). Any state → `voided` (terminal). Enforced by `packages/db/src/lifecycle.ts`. [CONFIRMED — AGENTS.md, packages/db/CLAUDE.md]

---

## Key Architectural Patterns

### Postgres Outbox Pattern

The `distribution_outbox` table is the ONLY delivery queue. [CONFIRMED — AGENTS.md `"Postgres outbox is the ONLY queue"`, worker CLAUDE.md]

Flow: API enqueues a row → worker polls → atomic claim → deliver → atomic confirm.

The worker uses `claimNextAtomic` (SELECT FOR UPDATE SKIP LOCKED via RPC) to safely claim rows under concurrency.

### Pick Submission → Settlement Data Flow

[CONFIRMED — AGENTS.md, apps/api/CLAUDE.md]

```
POST /api/submissions
  → submission-service: validate, create CanonicalPick (status=validated)
  → promotion-service: evaluate 5-score eligibility, persist to pick_promotion_history
  → distribution-service: enqueue to distribution_outbox (gated — only qualified picks)
  → worker polls outbox → claims row → DeliveryAdapter (Discord or simulation)
  → on success: confirmDeliveryAtomic (markSent + lifecycle + receipt + audit in one transaction)
  → POST /api/picks/:id/settle
  → settlement-service: write settlement_records, transition status to settled, write audit_log
```

### Promotion Scoring System

[CONFIRMED — apps/api/CLAUDE.md, packages/contracts/CLAUDE.md, packages/domain/CLAUDE.md]

Five score components evaluated per pick:
1. `edge` — model probability vs market probability
2. `trust` — CLV-adjusted trust signal
3. `readiness` — timing/market readiness
4. `uniqueness` — pick uniqueness (currently hardcoded to 50 in API service)
5. `boardFit` — portfolio/board fit

Scores are weighted per `bestBetsPromotionPolicy` (minimum threshold: 70.00). Policy definitions and scoring weights live in `packages/contracts/src/promotion.ts`. Scoring computation lives in `packages/domain/src/promotion.ts`. Results persist to `pick_promotion_history`.

### Circuit Breaker

[CONFIRMED — apps/worker/CLAUDE.md, apps/ingestor/CLAUDE.md]

Both the worker and ingestor implement per-target circuit breakers: 5 consecutive failures opens the circuit for 5 minutes. In-memory only — resets on restart.

### Repository Bundle Pattern

Services receive a `RepositoryBundle` or individual repos — they never create DB clients directly. This is what enables unit tests to run without a live database. [CONFIRMED — AGENTS.md, apps/api/CLAUDE.md]

### Shadow Mode and Verification

[CONFIRMED — packages/verification/CLAUDE.md]

`packages/verification` implements a 5-layer (R1-R5) verification architecture:
- R1: Clock abstraction and adapter interfaces
- R2: Deterministic replay
- R3: Shadow mode (parallel pipeline, divergence detection)
- R4: Fault injection with assertion engine
- R5: Strategy evaluation and proof bundles

---

## Discord Delivery Layer

**Library:** discord.js ^14.25.1 [CONFIRMED — apps/discord-bot/package.json]

**Live targets:** [CONFIRMED — AGENTS.md, CLAUDE.md]

| Target | Channel ID | Status |
|---|---|---|
| `discord:canary` | `1296531122234327100` | Live |
| `discord:best-bets` | `1288613037539852329` | Live |
| `discord:trader-insights` | `1356613995175481405` | Live |
| `discord:recaps` | `1300411261854547968` | Live |
| `discord:exclusive-insights` | `1288613114815840466` | Code merged — activation deferred |
| `discord:game-threads` | — | Not implemented |
| `discord:strategy-room` | — | Not implemented |

**Delivery adapter:** `apps/worker/src/delivery-adapters.ts` — HTTP POST to Discord channel. Also provides simulation (mock receipt) and dry-run (logs only) adapters. [CONFIRMED — apps/worker/CLAUDE.md]

**Bot commands (9):** alerts-setup, heat-signal, help, leaderboard, pick, recap, stats, trial-status, upgrade. [CONFIRMED — apps/discord-bot/CLAUDE.md]

---

## External Data Providers

[CONFIRMED — apps/ingestor/CLAUDE.md, .env.example]

- **SGO API** (`SGO_API_KEY`): Primary odds and props provider. Normalizes to `NormalizedProviderOffer`.
- **The Odds API** (`ODDS_API_KEY`): Pinnacle, DraftKings, FanDuel, BetMGM. Multi-book consensus + sharp line (Pinnacle CLV).
- **OpenAI** (`OPENAI_API_KEY`): Used in `packages/intelligence` and `apps/alert-agent`. [CONFIRMED — .env.example, packages/contracts/CLAUDE.md note]

Supported leagues: `['NBA', 'NFL', 'MLB', 'NHL']` — configurable via `UNIT_TALK_INGESTOR_LEAGUES`. [CONFIRMED — apps/ingestor/CLAUDE.md]

---

## Build and Run Commands

[CONFIRMED — root package.json scripts]

```bash
# Install
pnpm install

# Build all (TypeScript project references)
pnpm build

# Type check (no emit)
pnpm type-check

# Lint
pnpm lint

# Run all unit tests
pnpm test

# DB smoke test (requires live Supabase credentials)
pnpm test:db

# Full verification gate (env:check + lint + type-check + build + test)
pnpm verify

# Run a single test file
tsx --test apps/api/src/submission-service.test.ts

# Regenerate Supabase types after a migration
pnpm supabase:types

# Start API dev server (from repo root — local.env path dependency)
npx tsx apps/api/src/index.ts

# Start worker
pnpm worker:start

# Start ingestor
pnpm ingestor:start

# Operational brief (one-command snapshot)
pnpm ops:brief
```

**Test suite structure** (from package.json `test` script): [CONFIRMED]
- `test:apps-api-core` — 9 api test files (submission, settlement, scoring, CLV, grading, etc.)
- `test:apps-api-agent` — 13 api agent test files (grading-cron, recap, alerts, hedge, shadow, etc.)
- `test:apps-rest` — 14 test files across worker, ingestor, operator-web, discord-bot, and db packages
- `test:smart-form` — 3 test files
- `test:verification` — 4 test files
- `test:domain-*` — 7 domain sub-suites (probability, features, signals, hedge, shadow, analytics)

---

## Environment Variables

Loaded from `local.env` → `.env` → `.env.example` (later overrides earlier). `local.env` and `.env` are gitignored. No dotenv package — `@unit-talk/config` parses env files directly. [CONFIRMED — AGENTS.md]

Key categories (from `.env.example`): [CONFIRMED]

| Category | Key prefix |
|---|---|
| Core | `NODE_ENV`, `UNIT_TALK_APP_ENV` |
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` |
| API auth | `UNIT_TALK_API_KEY_OPERATOR`, `_SUBMITTER`, `_SETTLER`, `_POSTER`, `_WORKER` |
| SGO ingestor | `SGO_API_KEY`, `UNIT_TALK_INGESTOR_*` |
| Worker | `UNIT_TALK_WORKER_*`, `UNIT_TALK_DISTRIBUTION_TARGETS`, `UNIT_TALK_DISCORD_TARGET_MAP` |
| Alert agent | `ALERT_AGENT_ENABLED`, `ALERT_DRY_RUN`, `ALERT_THRESHOLD_*` |
| Discord bot | `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, role IDs |
| Linear | `LINEAR_API_TOKEN`, `LINEAR_TEAM_ID` |
| Notion | `NOTION_API_KEY`, `NOTION_DATABASE_ID` |
| OpenAI | `OPENAI_API_KEY` |
| Odds API | `ODDS_API_KEY` |
| Loki (optional) | `LOKI_URL` |
| Scoring | `UNIT_TALK_SCORING_PROFILE` (`default` or `conservative`) |

**Auth bypass:** In `fail_open` mode (`UNIT_TALK_APP_ENV=local`) with no API keys configured, auth is bypassed. In production (`fail_closed`), at least one key must be configured. [CONFIRMED — .env.example, apps/api/CLAUDE.md]

---

## Naming and File Conventions

[CONFIRMED — from source file inspection across packages]

- **File naming:** kebab-case (e.g., `submission-service.ts`, `circuit-breaker.ts`)
- **Test files:** co-located with source, named `<module>.test.ts`
- **Import paths:** use `.js` extension in TypeScript source (NodeNext resolution)
- **Barrel exports:** each package has `src/index.ts` as its barrel re-exporter
- **Repository naming:** `InMemory<Name>Repository` and `Database<Name>Repository`
- **Service functions:** pure functions receiving repository bundles — no class-based services
- **Build artifacts:** compiled to `dist/`. Never commit or hand-edit `dist/`, `*.js`, `*.d.ts`, `*.map` files under `src/`
- **Generated file:** `packages/db/src/database.types.ts` — regenerate after migrations; never hand-edit

---

## Known Drift / Issues

[CONFIRMED — app CLAUDE.md files]

1. `apps/alert-agent` imports directly from `apps/api/src/` — cross-app import violation. Alert logic should migrate to a shared package.
2. Rate limiting in `apps/api` is in-memory, per-process — not distributed.
3. Circuit breaker state is in-memory — resets on process restart.
4. `packages/verification` has pre-existing type errors in `shadow-pipeline-runner.ts` and `divergence-classifier.ts`.
5. 3 pre-existing test failures in `apps/api/src/promotion-edge-integration.test.ts` on main.
6. Uniqueness score input is hardcoded to 50 in the API service — no signal wired yet.
7. InMemory settlement repo does not enforce the `settlement_records_pick_source_idx` unique constraint.

---

## Scripts Directory

`scripts/` contains operational tooling run via `pnpm <script-name>`: [CONFIRMED — root package.json scripts, `ls` of root]

- `ops-brief.ts` — one-command system snapshot
- `linear-workflow.ts` — Linear issue management
- `github-workflow.ts` — PR/check status
- `worker-supervisor.ts` / `ingestor-supervisor.ts` — process management
- `t1-proof-bundle.ts` — T1 verification gate
- `validate-env.mjs` — env var validation
- `generate-types.mjs` — Supabase type regeneration
- `pipeline-health.ts` — pipeline health report

---

## External Integrations

### Notion Sync (`scripts/notion-sync.ts`)

[CONFIRMED — scripts/notion-sync.ts read directly]

`notion-sync.ts` reads `docs/06_status/PROGRAM_STATUS.md`, extracts structured data from its markdown tables (last-updated date, current state fields, gate status, open risks, key capability headings), then creates a dated checkpoint page in a Notion database via the `@notionhq/client` SDK. The script is additive-only — it never updates or deletes existing Notion content. Run with `pnpm notion-sync` (requires `NOTION_API_KEY` and `NOTION_DATABASE_ID` in env).

### Process HTTP Surfaces

[CONFIRMED — entry points read directly: apps/worker/src/index.ts, apps/ingestor/src/index.ts, apps/alert-agent/src/main.ts]

The three background daemons expose **no HTTP server**. They are pure polling processes:

| Process | Entry point | HTTP surface | Port |
|---|---|---|---|
| `apps/worker` | `src/index.ts` | None | None |
| `apps/ingestor` | `src/index.ts` | None | None |
| `apps/alert-agent` | `src/main.ts` | None | None |

The ingestor makes outbound POST requests to `UNIT_TALK_API_URL/api/grading/run` after each cycle to trigger grading, but does not bind any listener port itself.

Apps with HTTP servers and their ports:

| App | Port |
|---|---|
| `apps/api` | 4000 |
| `apps/smart-form` | 4100 |
| `apps/operator-web` | 4200 |
| `apps/command-center` | 4300 |
