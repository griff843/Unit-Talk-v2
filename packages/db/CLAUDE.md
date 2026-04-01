# Package: @unit-talk/db

Database layer: Supabase client, repository interfaces, InMemory + Database implementations, pick lifecycle FSM, schema enums, and writer authority.

## Role in Unit Talk V2

- System layer: **persistence / data access**
- Runtime: yes (Supabase client, DB queries)
- Maturity: rich (17 repository interfaces, 34 implementations, 3 test files)

## Role in Dependency Graph

**Imports:** `@supabase/supabase-js`, `@unit-talk/config`, `@unit-talk/contracts`

**Depended on by:** `apps/api`, `apps/worker`, `apps/ingestor`, `apps/operator-web`

## What Lives Here

- `src/index.ts` — barrel export + `canonicalTables` (24 tables)
- `src/client.ts` — Supabase client factory (`createDatabaseClient`, `createServiceRoleDatabaseConnectionConfig`)
- `src/repositories.ts` — 17 repository interfaces + input/output types + `RepositoryBundle` + `IngestorRepositoryBundle`
- `src/runtime-repositories.ts` — 17 InMemory + 17 Database class implementations + 4 factory functions
- `src/lifecycle.ts` — pick FSM (`transitionPickLifecycle`, `ensurePickLifecycleState`, `atomicClaimForTransition`)
- `src/schema.ts` — 20+ enum/status arrays + `TableDefinition` schema (23 tables with owners)
- `src/types.ts` — row type aliases derived from `database.types.ts` + manual types
- `src/writer-authority.ts` — field-level write authorization (5 registered fields)
- `database.types.ts` — Supabase-generated types (never hand-edit)

## Core Concepts

**Dual implementation pattern:** every repository has InMemory (tests/local dev) and Database (production) implementations. InMemory uses Maps/arrays. Database uses Supabase `.from().insert()/update()/select()`.

**Atomic RPC methods:** `processSubmissionAtomic`, `enqueueDistributionAtomic`, `claimNextAtomic`, `confirmDeliveryAtomic`, `settlePickAtomic` — Database implementations call Postgres stored procedures via `.rpc()`. InMemory implementations throw (service layer catches and falls back to sequential).

**Pick lifecycle FSM:** `draft → validated → queued → posted → settled` (terminal). Any state → `voided` (terminal). No regressions. Enforced in `lifecycle.ts`.

**Writer authority:** 5 fields have explicit write authorization (`status`, `promotion_target`, `posted_at`, `settled_at`, `submitted_by`). Unregistered fields are fail-open.

**Outbox claim lifecycle:** `claimNext` → `touchClaim` (heartbeat) → `reapStaleClaims` (release stuck rows). Atomic claim uses `SELECT FOR UPDATE SKIP LOCKED` via RPC.

## Runtime Behavior

- Database implementations make HTTP calls to Supabase REST API (PostgREST)
- InMemory implementations are stateful in-process (data lost on restart)
- Client created with `persistSession: false`, `autoRefreshToken: false`
- No connection pooling visible — relies on Supabase SDK internals

## Tests

- `lifecycle.test.ts` — FSM transitions, invalid transitions, terminal states, allowed transitions
- `writer-authority.test.ts` — authorization passes/failures, field lookup, writable fields per role
- `member-tier-repository.test.ts` — tier activation/deactivation, counts, idempotency

Gap: no test compares InMemory vs Database behavior side-by-side. DB constraint enforcement (unique indexes, FKs) is not tested in InMemory mode.

## Rules

- `database.types.ts` is generated — never hand-edit, regenerate with `pnpm supabase:types`
- Row types derive from generated types — do not define row shapes manually
- Repository interfaces are the contract — implementations must satisfy them exactly
- Lifecycle transitions go through `transitionPickLifecycle()` only — never update `picks.status` directly
- Atomic methods are Database-only — InMemory throws, caller catches

## What NOT to Do

- Do not hand-edit `database.types.ts`
- Do not bypass the FSM by directly updating `picks.status` via Supabase client
- Do not add business logic to repositories (that belongs in domain or API services)
- Do not add new tables without updating `canonicalTables` and `canonicalSchema`
- Do not assume InMemory repos enforce DB constraints (they don't)

## Known Drift or Cautions

- InMemory settlement repo does not enforce the `settlement_records_pick_source_idx` unique constraint — tests may pass where production would reject duplicates
- `claimNext()` (non-atomic) has a SELECT-then-UPDATE race window — use `claimNextAtomic()` when on Database persistence
- `runtime-repositories.ts` is ~3900 lines — large file, consider splitting if it grows further


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
