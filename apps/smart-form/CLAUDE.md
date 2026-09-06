# App: apps/smart-form

Browser-based bet intake form — the **operator-facing front door of the entire pick pipeline**, and
the only surface through which a human capper creates a pick.

**Read first:** `docs/03_product/smart-form/intent.md` (product intent — the complete journey, the
three-tier resolution ladder, and what counts as verification here). Then the canonical contracts for
whatever you are touching: `docs/05_operations/SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md`,
`SMART_FORM_SPORTSBOOK_CONSTRAINT_CONTRACT.md`, `T1_SMART_FORM_LIVE_OFFER_UX_CONTRACT.md`,
`T1_SMART_FORM_V1_CONTRACT.md`, `T2_SMART_FORM_CONFIDENCE_CONTRACT.md`.

**It is not public-facing.** Access is allow-list-gated Google OAuth (see Runtime Behavior). Every
submission is pinned server-side to Track Only and cannot create member delivery.

## Role in Unit Talk V2

- System layer: **user intake (frontend)**
- Runtime: Next.js app (port 4100)
- Maturity: deployed, in contained internal pilot. Zod schema validation, Radix UI, Auth.js v5,
  6 unit test files + 4 Playwright e2e specs. Milestone 1 steps 1-2 passed in production
  2026-09-06 and step 4 is blocked by UTV2-1842, so no pick has persisted yet.

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
- `lib/participant-search.ts` — player/team autocomplete (DB-backed, sport-filtered)
- `lib/auth-allowlist.ts` — parses `ALLOWED_CAPPER_EMAILS` into `<email> -> <canonicalCapperId>`
- `auth.ts`, `lib/auth-config.ts`, `lib/auth-session-token.ts` — Auth.js v5 wiring
- `lib/market-types.ts`, `lib/catalog.ts` — sport-aware market/stat catalogs
- `e2e/` — Playwright specs (`auth-gate`, `phase-one`, `real-reference`, `smart-form-submission`).
  **No CI workflow runs these.** They are operator-run evidence, not a gate.
- `components/` — Radix UI primitives (Button, Input, Select, Toast, etc.)

## Core Concepts

**Source:** hardcoded to `'smart-form'`. Body size capped at 64KB.

**Validation:** Zod schema validates market type, selection, odds format. The form requires `capperConviction` (1-10 integer, required field, no default) — `buildSubmissionPayload()` (`lib/form-utils.ts`) maps it to submission `confidence` (capperConviction/10, capped at 0.99 for conviction=10 to avoid an exact-1.0 probability) and records `metadata.confidenceSource: 'capper-conviction'` so downstream code can distinguish this from a market-derived confidence signal. This has been wired since UTV2-255/UTV2-1379 — do not describe the form as lacking a confidence signal.

## Runtime Behavior

- Next.js on port 4100 in-container; published in production behind Caddy at
  `UNIT_TALK_SMART_FORM_DOMAIN` (the hostname is a secret and is not in the repo).
- **Authentication: Google OAuth via Auth.js v5, allow-list gated.** `auth.ts:24` admits a sign-in
  only when `findAllowedCapper(email, allowedCappers) !== null`. There is no unauthenticated path.
- **Canonical identity is load-bearing.** `ALLOWED_CAPPER_EMAILS` is a comma-separated list of
  `<email>=<canonicalCapperId>` pairs, `<canonicalCapperId>` matching `^[a-z0-9][a-z0-9_-]*$`. An
  entry without `=` is silently **dropped**, with no fallback to the email local part
  (`lib/auth-allowlist.ts:43-66`). `auth.ts:35-40` puts the resolved `capperId` in the session JWT,
  and `apps/api/src/handlers/submit-pick.ts:143-144` prefers that claim over the form's
  `submittedBy` — so it becomes the persisted identity of a real pick.
- **Track Only is pinned server-side, not by this app.** `handlers/submit-pick.ts:93-106` forces
  `metadata.distributionMode = 'track-only'` for an authenticated capper and refuses a contrary
  value; `:119-123` refuses a Smart Form submission declaring none; the controller returns
  `outboxEnqueued: false`. The UTV2-1672 guard set is mutation-tested.
- **Participant resolution has three tiers**, and which one was used must be recorded truthfully:
  canonical+event / structured team fallback (real canonical IDs, `eventId: null`, team sports only)
  / explicit manual `canonical-coverage-gap` (participant IDs must be `null`). The server verifies a
  claimed coverage gap against the catalog and refuses a false one
  (`apps/api/src/smart-form-validation.ts`). See intent.md §4.
- **Containment applies.** Provider ingestion and system picks are parked, so the canonical catalog
  is largely unpopulated (measured 2026-09-06: 0 future events; NCAAF/NCAAB/SOCCER 0 teams). The
  fallback tiers are the normal path, not an edge case. Populating reference data is a reserved
  decision — it is never the fix for a form defect.
- No polling.

## Tests

- `test/form-schema.test.ts` — Zod validation
- `test/form-utils.test.ts` — utilities, payload building, submission guards
- `test/api-client.test.ts` — API client
- `test/allowlist.test.ts` — `ALLOWED_CAPPER_EMAILS` parsing and capper resolution
- `test/auth-config.test.ts` — Auth.js configuration
- `test/control-plane-boundary.test.ts` — this app must not reach control-plane surfaces
- `e2e/*.spec.ts` — Playwright, **run by no CI workflow**; operator-run evidence only

**A passing unit test is the weakest evidence here.** Every defect the operator hit during the
pilot on 2026-09-06 was in code that merged green with passing tests: the schema always accepted
`-110` while the keypad had no minus key, and tests drive `evaluateSubmissionGuards` directly so
nothing asserted which control the UI rendered. Verify operator-facing behaviour at the level it
lives at. See intent.md §7.

## Rules

- Submit to API only — no direct DB access
- Source is always `'smart-form'`
- Validation must happen client-side (Zod) AND server-side (API validates again)

## What NOT to Do

- Do not add direct database access
- Do not change the capperConviction→confidence mapping without understanding scoring implications (see UTV2-1379 for the conviction=10 capping rationale)
- Do not bypass API for submissions
- **Do not describe this app as public or unauthenticated.** It has been allow-list-gated since
  #1488; a stale claim here propagates into real design decisions.
- **Do not weaken Track Only.** Any change near submission, enqueue, retry, requeue, the outbox or
  recap keeps its mutation check, and that check must still fail when the guard is removed.
- **Do not record a canonical resolution the server did not verify, or a coverage gap it did not
  prove.** A failed participant search is not a coverage gap — it is retryable, and conflating the
  two writes a permanent falsehood onto a real pick.
- **Do not prescribe `inputMode=\"numeric\"` or `\"decimal\"` on a signed field.** Neither keypad has a
  minus key. This is why `-110` and `-3.5` were unenterable on mobile (intent.md §6.1).
- **Do not use `inputMode` alone as evidence about a keyboard** — assert the rendered attribute and
  the persisted value, and claim only that.


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
