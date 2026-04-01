# App: apps/smart-form

Browser-based bet intake form. Public-facing Next.js app for submitting sports picks via validated form.

## Role in Unit Talk V2

- System layer: **user intake (frontend)**
- Runtime: Next.js app (port 4100)
- Maturity: production (Zod schema validation, Radix UI, 3 test files)

## Role in Dependency Graph

**Imports:** `next`, `react`, `react-hook-form`, `zod`, `@radix-ui/*`, `@unit-talk/contracts`

**Calls:** `apps/api` POST `/api/submissions`

## What Lives Here

- `app/page.tsx` — landing page
- `app/submit/page.tsx` — form page
- `app/submit/components/` — BetForm, BetDetailsSection, BetSlipPanel, MarketTypeGrid, SuccessReceipt
- `lib/form-schema.ts` — Zod validation (player-prop, moneyline, team-prop)
- `lib/form-utils.ts` — form utility functions
- `lib/api-client.ts` — submits to `/api/submissions` via fetch
- `lib/odds-validator.ts` — odds validation
- `lib/betting-utils.ts` — bet calculation helpers
- `lib/participant-search.ts` — player/team autocomplete
- `components/` — Radix UI primitives (Button, Input, Select, Toast, etc.)

## Core Concepts

**Source:** hardcoded to `'smart-form'`. Body size capped at 64KB.

**Validation:** Zod schema validates market type, selection, odds format. Form does NOT include `confidence` field — Smart Form picks get fallback scoring (deterministic 61.5 total score, blocked by confidence floor gate).

## Runtime Behavior

- Next.js dev server on port 4100
- Form submission: POST to API `/api/submissions`
- No auth header currently (submitter key should be added)
- No polling

## Tests

- `test/form-schema.test.ts` — Zod validation tests
- `test/form-utils.test.ts` — utility tests
- `test/api-client.test.ts` — API client tests

## Rules

- Submit to API only — no direct DB access
- Source is always `'smart-form'`
- Validation must happen client-side (Zod) AND server-side (API validates again)

## What NOT to Do

- Do not add direct database access
- Do not add confidence field without understanding scoring implications
- Do not bypass API for submissions


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
