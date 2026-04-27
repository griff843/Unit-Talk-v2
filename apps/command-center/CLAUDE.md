# App: apps/command-center

Next.js 14 operator intelligence dashboard. Interactive React UI for operator interventions — approve, deny, retry, settle, override promotions.

## Role in Unit Talk V2

- System layer: **operator control plane (frontend)**
- Runtime: Next.js app (port 4300)
- Maturity: active development (20+ components, no traditional tests, Playwright for E2E)

Reads directly from Supabase via `src/lib/data/`. Writes through `apps/api` via server actions with Bearer token auth.

## Role in Dependency Graph

**Imports:** `next`, `react`, `tailwindcss` (no `@unit-talk/*` packages — frontend only)

**Calls:** `apps/api` (POST mutations via server actions). All reads go direct to Supabase via `src/lib/data/`.

## What Lives Here

- `src/app/page.tsx` — dashboard home with health signal drill-down links
- `src/app/actions/` — 3 server actions: `intervention.ts`, `review.ts`, `settle.ts`
- `src/app/decisions/`, `exceptions/`, `held/`, `intelligence/`, `interventions/`, `performance/`, `picks/[id]/`, `picks-list/`, `review/` — operator pages
- `src/components/` — 20+ interactive components (BulkReviewBar, CorrectionForm, ExceptionPanel, HealthSignalsPanel, HeldPicksPanel, InterventionPanel, etc.)
- `src/lib/` — API client, types, utilities

## Core Concepts

**Server actions:** all mutations (settle, review, retry, rerun, override, requeue) use Next.js server actions that POST to API with `Authorization: Bearer` header from `UNIT_TALK_CC_API_KEY` env var.

**Data flow:** pages fetch directly from Supabase via `src/lib/data/` → render React components → user actions → server action → API POST.

## Runtime Behavior

- Next.js dev server on port 4300
- Server-side rendering for data pages
- No caching, no polling, no WebSocket — manual refresh
- `OPERATOR_IDENTITY` env var retained for backward compat in body fields

## Tests

None (traditional). Playwright E2E tests exist in `e2e/` directory.

## Rules

- Reads via `src/lib/data/` (direct Supabase), writes through `apps/api` — never call operator-web
- All mutations must include `Authorization` header
- No business logic duplication — UI only

## What NOT to Do

- Do not add new data fetching outside `src/lib/data/` — extend the data layer there
- Do not add business logic (scoring, promotion, settlement logic)
- Do not bypass API auth for mutations
- Do not add new write surfaces without corresponding API endpoints
- Do not reintroduce HTTP calls to operator-web — that dependency has been removed


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
