# App: apps/command-center

Next.js operator control plane. Interactive React UI for operator work on the live pick lifecycle.

## Product authority — read this first

**What Command Center should do is defined in exactly one place:
[`docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md`](../../docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md).**

That contract is the sole authority for purpose, users, launch scope, information architecture, the
page catalog, data-truth rules, read/write boundaries, auth expectations, operator workflows, state
terminology, UX behaviour and launch acceptance. Every other Command Center document in this
repository is archived under `docs/archive/command-center/` and is historical evidence only.

**This file defines no product behaviour.** It is the engineering instruction file for working in
this package. If a question is "what should this screen do?", the answer is in the contract, never
here. If the two ever disagree, the contract wins and this file is stale — fix this file.

## Role in Unit Talk V2

- System layer: **operator control plane (frontend)**
- Runtime: Next.js app (port 4300), deployed as the `command-center` service
- Maturity: active development

Reads directly from Supabase via `src/lib/data/`. Writes through `apps/api` via server actions with
Bearer token auth. Calls no other internal application to read — there is no intermediate read
backend, and `apps/operator-web` is not one.

## Role in Dependency Graph

**Imports:** `next`, `react`, `tailwindcss` (no `@unit-talk/*` packages — frontend only)

**Calls:** `apps/api` (POST mutations via server actions). All reads go direct to Supabase via
`src/lib/data/`.

## What Lives Here

- `src/app/` — routes, server actions under `src/app/actions/`
- `src/components/` — interactive components
- `src/lib/data/` — the single sanctioned read layer
- `src/lib/` — auth, API client, types, utilities
- `src/middleware.ts` — request authentication for every non-allowlisted path

## Core Concepts

**Server actions:** all mutations use Next.js server actions that POST to the API with an
`Authorization: Bearer` header from `UNIT_TALK_CC_API_KEY`.

**Actor identity:** resolved from the credentials the request itself carries, never from a derived
header. A development bypass is logged as an unauthenticated request, never as a named operator.

**Data flow:** page fetches via `src/lib/data/` → renders → operator action → server action → API POST.

## Tests

`node:test` + `tsx --test`. Playwright E2E tests in `e2e/`.

## Rules

- Reads via `src/lib/data/` (direct Supabase), writes through `apps/api`
- All mutations must include an `Authorization` header and an authenticated actor
- No business logic duplication — UI only
- Every new route inherits authentication by default; path shape is never an auth boundary

## What NOT to Do

- Do not add data fetching outside `src/lib/data/` — extend the data layer there
- Do not add business logic (scoring, promotion, settlement, delivery-eligibility logic)
- Do not bypass API auth for mutations
- Do not add a write surface without a corresponding API endpoint
- Do not introduce HTTP calls to other internal apps
- Do not build a pick-composition surface here — Smart Form is the canonical submission surface
  (contract §1.4, §4.4)
- Do not define product requirements in this file

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

**Legacy boundary:** the legacy production repository is reference-only. No implicit truth import from legacy behavior. Any reused behavior must have a v2 artifact or runtime proof.

**Verification gate:** `pnpm verify` runs env:check + lint + type-check + build + test. Use `pnpm test` for unit tests, `pnpm test:db` for live DB smoke tests.
