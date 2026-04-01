# Package: @unit-talk/contracts

Pure types, domain contracts, and configuration constants shared across every package and app. No runtime dependencies.

## Role in Unit Talk V2

- System layer: **contract / type authority**
- Pure: yes (no I/O, no side effects, no DB)
- Maturity: stable

This package defines what the system *is* — every other package implements behavior against these contracts.

## Role in Dependency Graph

**Imports:** `node:crypto` only (for `randomUUID` in `picks.ts`)

**Depended on by:** every `@unit-talk/*` package and every app

## What Lives Here

- `src/index.ts` — barrel export + `memberTiers`, `writerRoles`, `canonicalWriter`
- `src/submission.ts` — `SubmissionPayload`, `ValidatedSubmission`, `validateSubmissionPayload()`
- `src/picks.ts` — `CanonicalPick`, `LifecycleEvent`, `PickLifecycleState`, `materializeCanonicalPick()`
- `src/promotion.ts` — scoring weights, policies (best-bets/trader-insights/exclusive-insights), `ScoringProfile`, `PromotionDecisionSnapshot`, target registry, rollout controls, exposure gate config
- `src/settlement.ts` — `SettlementRequest`, `validateSettlementRequest()`, status/result/source/confidence enums
- `src/distribution.ts` — `DistributionWorkItem`, `createDistributionWorkItem()`
- `src/reference-data.ts` — `V1_REFERENCE_DATA` catalog (9 sports, 11 sportsbooks), lookup functions
- `src/provider-offers.ts` — `NormalizedProviderOffer`, `ProviderOfferInsert`
- `src/shadow-mode.ts` — `ShadowableSubsystem`, `ShadowModeConfig`
- `src/promotion.test.ts` — rollout + exposure gate tests

## Core Concepts

**Type-derived enums:** all union types derive from `as const` arrays (`memberTiers`, `writerRoles`, `promotionTargets`, etc.) for runtime + type safety.

**Promotion policy system:** three targets with independent weights, thresholds, board caps. Profiles (`default`, `conservative`) version-stamped for replay.

**Target registry:** runtime-configurable via `UNIT_TALK_ENABLED_TARGETS` env var. Rollout percentage uses deterministic FNV-1a hash bucketing.

**Decision snapshot:** `PromotionDecisionSnapshot` captures full context (profile, weights, inputs, board state, override) for deterministic replay.

## Runtime Behavior

None. Pure types and stateless functions.

## Tests

- `promotion.test.ts` — rollout config parsing, target registry resolution, FNV-1a hash determinism, exposure gate config

## Rules

- No runtime dependencies (no DB, no HTTP, no side effects)
- All shared types must originate here, not in consuming packages
- Enum arrays must stay `as const` — derived types depend on this
- Policy weights and thresholds are the scoring authority — domain implements, contracts define
- `V1_REFERENCE_DATA` is the canonical static catalog

## What NOT to Do

- Do not add runtime logic (I/O, fetching, DB queries)
- Do not duplicate types that belong in `@unit-talk/db` (row types stay in db)
- Do not add app-specific configuration (that belongs in the app or config)
- Do not modify policy weights without updating the `ScoringProfile` version

## Known Drift or Cautions

- `picks.ts` imports from `./index.js` (re-export cycle) — safe because types-only, but fragile if values are added
- `promotion_target_check` constraint in Postgres must be kept in sync with `promotionTargets` array manually


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
