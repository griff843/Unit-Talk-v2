# UTV2-64 — T2 DeviggingService Submission Wiring

**Status:** RATIFIED
**Lane:** `lane:codex` (T2 implementation)
**Tier:** T2
**Milestone:** M11
**Ratified:** 2026-03-27
**Authority:** Claude lane — M11 contract authoring session 2026-03-27

---

## Problem

The pure `devig()` computation in `packages/domain/src/probability/devig.ts` is fully implemented and tested but is never called at submission time. Picks are created without a devigged fair probability estimate, which means the promotion scoring edge component relies on raw odds rather than market-consensus fair value.

---

## Scope

At submission time, look up `provider_offers` for the pick's market key. If offers exist, run `devig()` and write the result to `pick.metadata.deviggingResult`. **Fail-closed: if no offers or devig throws, proceed without writing — submission must never fail due to missing market data.**

**No schema changes. No new routes. No new packages.**

---

## Key Files to Read Before Implementing

- `packages/domain/src/probability/devig.ts` — `devig()` signature and output type
- `apps/api/src/submission-service.ts` — existing enrichment pattern (domain analysis at step 4)
- `apps/api/src/clv-service.ts` — how `provider_offers` is queried and market key matched; use the same `normalizeMarketKey()` normalization
- `packages/db/src/repositories.ts` — `ProviderOfferRepository` interface

---

## Permitted Files

- `apps/api/src/submission-service.ts` — add devig enrichment step after existing domain analysis
- `apps/api/src/submission-service.test.ts` — add ≥2 tests

**Do NOT touch:** `apps/operator-web`, `apps/worker`, `apps/discord-bot`, `apps/smart-form`, `apps/ingestor`, `packages/*`

---

## Acceptance Criteria

- [ ] AC-1: `processSubmission` queries `providerOffers` for the pick's normalized market key
- [ ] AC-2: If offers found, calls `devig()` from `@unit-talk/domain` and writes result to `pick.metadata.deviggingResult`
- [ ] AC-3: If no offers found: submission completes successfully, `metadata.deviggingResult` absent
- [ ] AC-4: If `devig()` throws: error is caught and logged, submission completes successfully, `metadata.deviggingResult` absent
- [ ] AC-5: Market key normalization uses the same `normalizeMarketKey()` as CLV (`apps/api/src/clv-service.ts`) — not a hand-rolled match
- [ ] AC-6: `pnpm verify` exits 0; test count >= baseline + 2

---

## Constraints

- **Fail-closed is mandatory.** Any error in the devig path must be swallowed. This is submission-time enrichment, not a gate.
- Do not backfill existing picks — enrichment applies only to new submissions
- Do not change `CanonicalPick` schema or `contracts` package types — `metadata` is a free-form JSON field
- Read `clv-service.ts` market key match logic before writing the offer lookup — key format mismatch will silently find zero offers
