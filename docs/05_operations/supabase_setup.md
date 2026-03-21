# Supabase Setup

## Recommendation

Use a new Supabase project for V2. If separation is impossible, use a fully isolated schema with explicit ownership boundaries. The `public` schema is the canonical V2 schema and must not contain legacy tables.

## Canonical Tables

| Table | Owner | Purpose |
|---|---|---|
| `submissions` | api | Inbound V2 intake records before canonical pick creation |
| `submission_events` | api | Auditable submission-level events |
| `picks` | api | Canonical picks after validation and materialization |
| `pick_lifecycle` | api | Lifecycle transitions and authority-bearing actions |
| `distribution_outbox` | worker | Queues downstream distribution work away from synchronous handling |
| `distribution_receipts` | discord-bot | Delivery receipts from downstream channels |
| `settlement_records` | api | Authoritative grading outcomes for picks |
| `system_runs` | worker | Tracks long-running jobs and operational runs |
| `audit_log` | platform | Durable, immutable audit events for sensitive actions |
| `participants` | api | Canonical participant identities across sports entities |
| `participant_memberships` | api | Historical participant-to-parent relationships |

## Migration Files

- `supabase/migrations/202603200001_v2_foundation.sql` — Initial schema scaffold: all 11 canonical tables, status check constraints, foreign key relationships, baseline indexes.
- `supabase/migrations/202603200002_v2_schema_hardening.sql` — Schema hardening: `updated_at` triggers, `pick_lifecycle` column alignment (`lifecycle_state` → `to_state`, add `from_state`), `system_runs` additions (`created_at`, `idempotency_key`), `distribution_outbox` claim columns and idempotency key, `distribution_receipts` channel column, `settlement_records` correction support (`corrects_id`), `audit_log` immutability trigger and `entity_ref` column.
- `supabase/migrations/202603200003_distribution_receipts_idempotency.sql` — Adds `idempotency_key text` with unique partial index to `distribution_receipts`. Required by the distribution contract ("Discord-facing operations must be idempotent"). Mirrors the same pattern as `distribution_outbox.idempotency_key`.
- `supabase/migrations/202603200004_system_runs_finished_at_trigger.sql` — Adds BEFORE UPDATE trigger `system_runs_set_finished_at` that sets `finished_at = now()` (server clock) when status transitions from `running` to a terminal state (`succeeded`, `failed`, `cancelled`). Fixes `finished_at < started_at` observed after first live canary delivery: `started_at` was set by the DB default (server clock) but `finished_at` was set by `new Date().toISOString()` in the TypeScript layer (client clock). Any clock skew between the app host and the Supabase server caused the inversion. The application layer no longer sets `finished_at`.

## Rules

- Migrations are the source of schema truth. No schema changes outside of migration files.
- Generated types come from one canonical path (see Type Generation below).
- Client apps do not write directly to canonical business tables. All writes go through the API with writer authority checks.
- Canonical table metadata lives in `packages/db/src/schema.ts`.
- `audit_log` is immutable: the database enforces this via a before-mutation trigger. Only INSERT is permitted.
- `distribution_outbox` uses an `idempotency_key` (caller-supplied, unique when non-null) to prevent double-enqueue. The design intent is one outbox claim per logical work item, not one row per (pick, target).

## Type Generation

### Canonical path

```
supabase/migrations/*.sql                      ← schema source of truth
  → supabase gen types typescript --linked     ← Supabase CLI generation (live project)
    → packages/db/src/database.types.ts        ← generated output (commit to repo)
      → packages/db/src/types.ts               ← Row aliases via Tables<'table'> + enum unions
      → packages/db/src/repositories.ts        ← repository interfaces
```

### Current state

`packages/db/src/database.types.ts` is **generated from the live Supabase project** (`feownrheeefbcsehtsiw`). Both migrations were applied on **2026-03-20** and types were regenerated successfully. The type pipeline is fully operational.

### To regenerate

With the project linked (`supabase link --project-ref feownrheeefbcsehtsiw`):

```bash
pnpm supabase:types
```

This runs `supabase gen types typescript --linked --schema public | tail -n +2` and overwrites `packages/db/src/database.types.ts`. The `tail -n +2` strips the CLI banner line ("Initialising login role...") that Supabase CLI v2.x writes to stdout before the TypeScript output.

### Rules for database.types.ts

- Do NOT hand-edit this file. It is generated — any manual changes will be clobbered on the next `pnpm supabase:types` run.
- This file is committed to the repo so that CI can type-check without a live Supabase connection.
- Row types in `types.ts` are derived via `Tables<'table_name'>` from this file. Status/enum unions are narrowed in `types.ts` against `schema.ts`.

## Schema Decisions

The following design decisions are documented here to prevent re-litigation.

### pick_lifecycle column naming

`lifecycle_state` was renamed to `to_state` in migration 002 to align with the TypeScript `PickLifecycleRecord` interface. The `from_state` column was added at the same time. Both columns represent the before/after states of a lifecycle transition.

### picks.posted_at and picks.settled_at

These are denormalized cache columns. They are the authoritative source for quick reads but must be kept in sync with `pick_lifecycle` by the application layer. They are NOT maintained by a database trigger. The lifecycle contract is authoritative; these columns are convenience projections.

### worker visibility and heartbeats

V2 uses `system_runs` as the canonical operational record for worker/job visibility during the current foundation phase. We are not adding a separate `worker_heartbeats` table in Week 2. If later liveness requirements prove that `system_runs` is insufficient, a dedicated heartbeat table must be introduced through an explicit ADR or contract update rather than as a convenience addition.

### writer authority enforcement and RLS

Writer authority is currently enforced in the application layer. API and worker write paths must declare and respect writer role before mutating canonical tables. Postgres RLS is deferred for now, not prohibited. If adopted later, it should land in a dedicated security-focused migration after the service-role and runtime access patterns are stable.

### distribution_outbox idempotency

Idempotency is enforced via `idempotency_key text` with a unique partial index. We did NOT use `unique(pick_id, target)` because a pick may legitimately need re-delivery to the same target after a failed run (e.g., dead-letter re-queue). The caller is responsible for computing and supplying the key.

### settlement_records corrections

Corrections are modeled as new rows with `corrects_id` pointing to the original. The original record is never mutated. `corrects_id` has an `ON DELETE RESTRICT` foreign key to prevent deleting a settlement record that has been corrected.

### audit_log entity reference

`entity_id uuid` holds UUID primary keys. `entity_ref text` holds non-UUID external identifiers (e.g., Discord message IDs, external provider references). Populate one or both per row.

### participant_types

V2 supports `player`, `team`, `league`, `event`. Legacy types (`horse`, `fighter`, `golfer`, `driver`) are not included. This is a deliberate greenfield scope decision — these types require re-ratification before addition.

## Live DB Verification (2026-03-20)

Verified on project `feownrheeefbcsehtsiw` after applying both migrations:

### Migrations applied
| File | Status |
|---|---|
| `202603200001_v2_foundation.sql` | Applied |
| `202603200002_v2_schema_hardening.sql` | Applied |
| `202603200003_distribution_receipts_idempotency.sql` | Applied |
| `202603200004_system_runs_finished_at_trigger.sql` | Applied |

### Tables confirmed present (all 11)
`submissions`, `submission_events`, `picks`, `pick_lifecycle`, `distribution_outbox`, `distribution_receipts`, `settlement_records`, `system_runs`, `audit_log`, `participants`, `participant_memberships`

### Schema drift check (all columns verified against migrations)
Every column addition from migrations 002 and 003 appears in the generated `database.types.ts`:
- `pick_lifecycle`: `to_state` (renamed), `from_state` (added) ✓
- `system_runs`: `created_at`, `idempotency_key` ✓
- `distribution_outbox`: `claimed_at`, `claimed_by`, `idempotency_key` ✓
- `distribution_receipts`: `channel`, `idempotency_key` ✓
- `settlement_records`: `corrects_id` ✓
- `audit_log`: `entity_ref` ✓

### Type generation
- `pnpm supabase:types` (`--linked`) ran clean against live project
- `packages/db/src/database.types.ts` replaced with generated output (exports `Tables<>`, `Json`, helpers only — no named Row exports)
- `packages/db/src/types.ts` derives all `*Row` / `*Record` aliases via `Tables<'table_name'>`
- `pnpm type-check` and `pnpm build` both pass clean

### Receipt path readiness (as of migration 003)
`distribution_receipts` is ready for the next receipt-recording slice:
- `outbox_id` FK → links receipt to the outbox row being processed ✓
- `external_id` → external reference (Discord message ID, etc.) ✓
- `receipt_type` → category of receipt (e.g. `discord.message`) ✓
- `status` → delivery outcome ✓
- `channel` → per-channel delivery identity ✓
- `idempotency_key` → caller-controlled deduplication (NEW in migration 003) ✓
- `payload` → full receipt payload ✓
- `recorded_at` → insertion timestamp ✓
- `ReceiptCreateInput` and `ReceiptRepository` interfaces defined in `packages/db/src/repositories.ts` ✓
- `ReceiptRecord` type alias available via `Tables<'distribution_receipts'>` ✓
- `InMemoryReceiptRepository` and `DatabaseReceiptRepository` implemented in `apps/api/src/persistence.ts` ✓
- `RepositoryBundle.receipts` slot populated ✓

### DB smoke test
- `pnpm test:db` — **PASS** (1/1) against live Supabase project
- Executes a full submission + pick + lifecycle insert via `DatabaseSubmissionRepository` and `DatabasePickRepository`
- Verifies saved pick is queryable via `findPickById`
- Cleans up all inserted rows on completion
- Fix applied: `processSubmission` was racing FK constraints (all 4 DB writes in `Promise.all` despite `pick_lifecycle → picks` FK dependency). Fixed to: save submission → parallel(save event + save pick) → save lifecycle event. See `apps/api/src/submission-service.ts`.

### Env/runtime assumptions
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` must be set for `pnpm test:db` to run (not skip)
- Values for the live project live in `local.env` (never committed)
- `SUPABASE_ACCESS_TOKEN` (`sbp_...` format) required for CLI management operations (`supabase link`, `supabase db push`, `pnpm supabase:types`)
- `SUPABASE_PROJECT_REF` in `local.env` for `supabase link`
- `local.env` is gitignored; `.env.example` has blank placeholders for all four
- `UNIT_TALK_ACTIVE_WORKSPACE` and `UNIT_TALK_LEGACY_WORKSPACE` must be set (come from `.env.example` defaults)

## Local Development

### Start local Supabase

```bash
npx supabase start
```

### Reset and replay all migrations

```bash
npx supabase db reset
```

### Run a specific migration manually

```bash
npx supabase db push
```

### Regenerate TypeScript types after schema change

```bash
pnpm supabase:types
```
