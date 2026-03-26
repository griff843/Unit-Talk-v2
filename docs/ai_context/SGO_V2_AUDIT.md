# SGO V2 Audit

> Produced: 2026-03-25
> Purpose: V2 truth-first audit of SportsGameOdds integration. V2 runtime wins — no legacy assumptions imported without explicit re-ratification.

## 1. Executive Summary

SGO integration does not exist in V2 as a runtime capability. The only V2 artifacts that reference SGO are a static sportsbook catalog entry in `@unit-talk/contracts` and a book-profile classification in `@unit-talk/domain` — both are pure data declarations with no fetch, parse, or persistence logic attached. The production readiness checklist explicitly flags odds ingestion as the highest-leverage unblocked item (item 4.1), confirming the gap is recognized. The domain package contains the full math layer (devig, consensus, signal quality, market signals) needed to consume multi-provider data once it arrives, but there is no inbound data path to feed it. No V2 migration, service, handler, or env var establishes an ingestion surface.

## 2. Current V2 Repo Truth

### 2.1 Schema / DB

Migration 008 (`202603200008_reference_data_foundation.sql`) creates a `sportsbooks` table and seeds it with 11 entries including `('sgo', 'SGO', 11)`. This is a reference catalog row — it registers SGO as a known sportsbook for form validation and display purposes only.

No tables exist in V2 for:
- `provider_offers` (no migration)
- `raw_props` (no migration)
- `api_credit_log` (no migration)
- `offer_quarantine` (no migration)
- Any ingestion or market-data staging table

The `events` and `event_participants` tables from migration 008 exist as reference scaffolding but contain no SGO-specific columns and have no FK relationship to any ingestion surface.

### 2.2 Contracts & Types

`packages/contracts/src/reference-data.ts`:
- `sportsbooks` array in `V1_REFERENCE_DATA` includes `{ id: 'sgo', name: 'SGO' }` (line 163)
- `isValidSportsbook()` will return `true` for `'sgo'`
- No provider-specific fetch types, no ingestion payload types, no `ProviderOfferPayload` equivalent

`packages/domain/src/probability/devig.ts`:
- `BookProfile`, `LiquidityTier`, `DataQuality` types defined
- `BookOffer` interface defined — this is the normalized input to `computeConsensus()`
- `computeConsensus()`, `proportionalDevig()`, `calculateEdge()`, `calculateCLVProb()` all implemented and tested

`packages/domain/src/market/book-profiles.ts`:
- `BOOK_PROFILES` record includes `sgo: { profile: 'retail', liquidity: 'medium' }` (line 22)
- `getBookProfile()` pure lookup function; used by `computeSignalVector()`

`packages/domain/src/signals/market-signals.ts`:
- `ProviderOfferSlim` interface defined — this is the expected shape of provider data for signal computation
- Fields: `provider`, `line`, `over_odds`, `under_odds`, `snapshot_at`, `is_opening`, `is_closing`
- `computeSignalVector()` consumes `ProviderOfferSlim[]` — fully implemented, no data source wired to it

No equivalent of `NormalizedMarketOffer` or `ProviderOfferPayload` contract types exist in V2.

### 2.3 Services & Code

`apps/api/src/`:
- No ingestion service, no feed handler, no provider fetch wrapper
- `settlement-service.ts` blocks `source === 'feed'` explicitly at line 63 — governance guard, not an active path
- `domain-analysis-service.ts` computes implied probability and Kelly sizing from a pick's single-book American odds — no multi-book consensus consumed

No `apps/worker` or `apps/api` code calls any external odds API. No HTTP clients for `api.sportsgameodds.com` or `api.the-odds-api.com` exist in V2.

### 2.4 Config & Env

`.env.example` — SGO-related entries: none.

No `SGO_API_KEY`, `ODDS_API_KEY`, or `OPTIMAL_API_KEY` variables declared in V2's `.env.example`. The only external API key present is `OPENAI_API_KEY`.

### 2.5 Docs

`docs/06_status/production_readiness_checklist.md`:
- Item 4.1: "Odds API integration — provider 1 (OddsAPI)" — status `⬜` (not started), tier T1, noted as **highest-leverage unblocked item**
- Item 4.2: "Canonical odds ingestion service" — status `⬜`, T1, "Provider-agnostic interface; ingests to `raw_props` equivalent"
- Items 4.8–4.10 reference multi-provider ingestion as T2/T3 work

No doc explicitly describes SGO as the first target; item 4.1 names OddsAPI as provider 1 and item 4.8 references "Optimal/Elite Dual-API" for provider 2. SGO appears in the checklist only implicitly as the V2-cataloged sportsbook.

No dedicated SGO integration doc exists in `docs/`.

## 3. SGO Status

**Missing** — with partial catalog scaffolding only.

Evidence:
- SGO entry in `sportsbooks` catalog (migration 008) and `V1_REFERENCE_DATA` confirms it is a recognized provider name
- SGO entry in `BOOK_PROFILES` confirms the book-profile weighting is defined for consensus math
- No `SGO_API_KEY` env var, no HTTP client, no fetch function, no ingestion table, no migration for market data storage
- No ingestion service, no handler, no route exists anywhere in V2 apps
- Production readiness checklist explicitly lists the entire ingestion track as not started

## 4. Provider Architecture Findings

V2 currently implies the following from what exists:

1. **Provider-neutral math layer is ready.** `computeConsensus()`, `computeSignalVector()`, and `computeSignalQuality()` are all implemented and tested. They accept abstract `BookOffer[]` / `ProviderOfferSlim[]` inputs — any provider can feed them once data is in the right shape.

2. **Book profile classification is ready.** `BOOK_PROFILES` maps 11 known sportsbooks (including SGO) to `BookProfile` + `LiquidityTier`. This is the weighting input for consensus computation.

3. **Reference catalog is ready.** The `sportsbooks` DB table and `V1_REFERENCE_DATA` provide the canonical list of known providers. Validation helpers (`isValidSportsbook()`) are already usable.

4. **No ingestion contract, storage layer, or data path exists.** The math can consume multi-provider data; there is nothing to produce it. The gap is entirely on the inbound side.

5. **The `ProviderOfferSlim` interface in `market-signals.ts` is the closest V2 analog to a normalized provider offer.** It lacks persistence fields (no `id`, no `pick_id` FK, no DB representation). It is analysis-only.

6. **Settlement service explicitly guards against automated feed writes.** Any future auto-settlement from an ingestion feed requires a separate written and ratified contract before it can be wired.

## 5. Legacy Concepts Worth Preserving

The following patterns from legacy are architecturally valid for V2. These are patterns only — no code should be ported without re-ratification:

1. **Fetch → Flatten → Pair pipeline.** SGO's API returns event-keyed odds objects with individual over/under rows. A fetch → flatten → pair-over-under pipeline is the correct normalization approach. The key grouping (`eventID + playerName + statType + line`) is well-reasoned. The `devig_mode` flag (`PAIRED` vs `FALLBACK_SINGLE_SIDED`) is a useful data quality signal.

2. **Provider-agnostic normalized offer interface.** A single `NormalizedMarketOffer` (or V2 equivalent) that all provider adapters write to is the right abstraction. It decouples the math layer from provider-specific shapes.

3. **Single writer / upsert-with-idempotency.** Legacy used an `upsert_provider_offers_bootstrap` RPC with a provider key + event key. The pattern of a single canonical write surface with idempotency is consistent with V2's architecture for other tables.

4. **Provider key as a stable string identifier.** Using `'sgo'` as the stable `provider_key` (lowercase string, matching the `sportsbooks.id` FK) is the right approach for V2's reference-data-backed design.

5. **Credit tracking per external API call.** Logging API credit consumption to a dedicated table is operationally necessary for multi-provider environments. This should be scoped to any provider with a credit-based quota.

6. **Failover routing between providers.** The data source router pattern (primary → fallback → final fallback) is the right architecture for production reliability. This should be codified in a V2 contract before implementation.

## 6. Gaps and Risks

| Gap | Risk |
|-----|------|
| No `provider_offers` table or equivalent in V2 schema | Cannot persist any ingested market data; entire ingestion track is blocked on schema migration |
| No `raw_props` or staging table | No quarantine or backfill path; data loss risk if upstream provides partial or malformed data |
| No `SGO_API_KEY` env var in `.env.example` | Any implementation attempt will silently skip ingestion if env is unconfigured; easy to miss in CI |
| No `api_credit_log` table | Cannot track external API quota consumption; risk of surprise quota exhaustion across environments |
| `ProviderOfferSlim.provider` is a plain string | No FK enforcement to `sportsbooks` table; reference integrity must be application-enforced |
| `computeSignalVector()` is analysis-only with no persistence path | Signal outputs computed in the math layer cannot be stored or acted on without a new service layer |
| `market-signals.ts` JSDoc says "Computes signal features from provider_offers data" | Implies a DB table of that name; no such table exists in V2 — docs ahead of runtime |
| Settlement feed guard exists but feed path does not | When ingestion is built, the feed settlement gate will need an explicit ratified contract before it can be removed |
| Legacy used three providers (SGO, OddsAPI, Optimal); V2 readiness checklist names OddsAPI as provider 1 | The order of provider integration is not yet decided/contracted for V2; first contract must resolve this |
| No circuit breaker or rate limit coordination defined for V2 | Legacy had Redis-backed caching; V2 has no caching layer at all |

## 7. Recommendation for T1 Ingestion Contract

Before a T1 contract can be written, the following must be decided and documented:

1. **Which provider is first?** The readiness checklist says OddsAPI for item 4.1; SGO is an alternative first choice given zero credit cost. This must be explicitly chosen and stated in the contract.

2. **What is the canonical storage schema?** A migration for at minimum `provider_offers` must be designed: what columns, what FKs (to `events`, `sportsbooks`, `participants`?), what idempotency key, what snapshot semantics (one row per offer per snapshot vs. upsert-in-place).

3. **What is the normalized offer shape?** A V2 `NormalizedProviderOffer` type must be ratified in `@unit-talk/contracts` (not just `ProviderOfferSlim` which is analysis-only and lives in domain).

4. **Who is the single writer?** The contract must designate which app owns ingestion writes. Based on V2 architecture, `apps/api` is the canonical DB writer; a new `apps/ingestor` or a scheduled route within `apps/api` are the two realistic options.

5. **What is the polling/scheduling mechanism?** V2 has no scheduler. Is it a cron job, a new worker, a Temporal workflow? This must be decided before implementation.

6. **What env vars are needed?** At minimum `SGO_API_KEY` (and/or `ODDS_API_KEY`). These must be added to `.env.example` and documented.

7. **Is there a credit log requirement?** For any credit-based API, a `api_credit_log` table or equivalent must be part of the migration scope.

## 8. Minimum Implementation Slice

After the contract is written, the smallest first slice that delivers real value and can be independently verified:

**Slice: SGO fetch → normalize → persist to `provider_offers`**

Scope:
- One new migration: `provider_offers` table (provider_key FK to sportsbooks, provider_event_id text, provider_market_key text, line numeric, over_odds integer, under_odds integer, snapshot_at timestamptz, is_opening boolean, is_closing boolean, idempotency_key unique partial index)
- One new env var: `SGO_API_KEY` added to `.env.example`
- One new package or service: `sgo-fetcher.ts` with `fetchAndPairSGOProps` (V2 native, not ported from legacy), pure TypeScript, no side effects
- One adapter: `normalizeSGOProp()` — maps `SGOPairedProp` to a `ProviderOfferInsert` shape
- One repository interface + implementation: `ProviderOfferRepository.upsertBatch()` in `@unit-talk/db`
- One ingest function: `ingestSGOLeague(league, apiKey, repo)` — pure, testable, no HTTP in tests
- One scheduled entry point (TBD mechanism): invokes ingest for configured leagues
- ≥4 unit tests: fetch normalization, devig_mode flag, idempotency on re-ingest, empty-response guard

Verification criteria (independently checkable):
- `provider_offers` rows exist in live DB with `provider_key = 'sgo'`
- Row count increases on re-run only for new props (idempotency proven)
- `snapshot_at` timestamps are server-set
- No `api_credit_log` entries (SGO has no credit cost — confirms correct provider was called)
- `pnpm test` count does not decrease; `pnpm type-check` passes

This slice is self-contained, does not touch the submission/promotion/distribution pipeline, and provides real data that the existing `computeConsensus()` and `computeSignalVector()` math can immediately consume in future slices.
