# Provider Ingestion — Architecture Decisions

> Produced: 2026-03-25
> Status: Ratified — forms the basis for T1_PROVIDER_INGESTION_CONTRACT.md
> V2-native decisions. No legacy assumptions imported without explicit justification.

## 1. Executive Summary

SGO (SportsGameOdds) is the correct first provider for V2 ingestion because it has zero API credit cost, is already cataloged in the V2 `sportsbooks` table and `BOOK_PROFILES`, and its API shape (flat event-keyed odds objects requiring over/under pairing) is well-understood from the legacy audit. OddsAPI is designated the secondary/fallback provider but is explicitly out of scope for slice 1 — it requires separate env vars, credit tracking infrastructure, and its own normalization adapter. The primary goal of slice 1 is to establish the canonical `provider_offers` schema, the `NormalizedProviderOffer` contract type, and a working end-to-end SGO fetch → normalize → persist pipeline that the existing math layer can immediately consume. All architecture decisions follow V2 single-writer discipline: `apps/api` is the sole canonical DB writer.

## 2. Current V2 Repo Truth (brief — full detail in SGO_V2_AUDIT.md)

What exists:
- `sportsbooks` table (migration 008): SGO row seeded as `('sgo', 'SGO', 11)`
- `BOOK_PROFILES` in `@unit-talk/domain`: `sgo: { profile: 'retail', liquidity: 'medium' }`
- `V1_REFERENCE_DATA` in `@unit-talk/contracts`: `{ id: 'sgo', name: 'SGO' }` in sportsbooks array
- Full math layer: `computeConsensus()`, `computeSignalVector()`, `computeSharpRetailDelta()` — all implemented, tested, no live data feeding them
- `ProviderOfferSlim` in `@unit-talk/domain/signals/market-signals.ts` — analysis-only, no persistence fields
- `BookOffer` in `@unit-talk/domain/probability/devig.ts` — math input only, no persistence fields

What does not exist:
- `provider_offers` table (no migration)
- `api_credit_log` table (no migration)
- `NormalizedProviderOffer` type in `@unit-talk/contracts`
- Any HTTP client, fetcher, normalizer, or ingestion service in V2
- `SGO_API_KEY` env var in `.env.example`
- Any scheduled entry point or polling loop for ingestion

---

## 3. Decision 1 — Provider Priority

### Chosen: SGO as primary; OddsAPI as secondary, deferred to slice 2

### Reasoning:
SGO has zero credit cost, which removes the most significant operational risk from a first slice: accidental quota exhaustion during development, CI, or repeated test runs. The V2 repo already catalogs SGO as a known sportsbook and has its book profile (`retail`, `medium` liquidity) registered in `BOOK_PROFILES`. The legacy audit confirms the SGO API shape is straightforward: a single `GET /v2/events` endpoint returns event-keyed odds objects; the only normalization complexity is pairing the separate over/under market keys, which the legacy `pairOverUnderProps` pattern demonstrates clearly. Starting with a zero-cost provider means the persistence schema, repository interfaces, and scheduling infrastructure can be validated against real data before any credit-bearing provider is wired.

### Operational meaning of "secondary" in slice 1:
OddsAPI is not built, triggered, or referenced in slice 1. It exists only as a planned future provider. No fallback routing, no provider-selection logic, and no credit-log table are required in slice 1. When OddsAPI is added in slice 2, it will use the same `provider_offers` table and `NormalizedProviderOffer` contract already established in slice 1 — the schema is designed to be provider-agnostic from day 1.

### Risks:
- SGO book profile is `retail` with `medium` liquidity — it will not be weighted heavily in `computeConsensus()` when sharp books are also present. This is correct behavior, not a defect. Single-book SGO data gives limited consensus signal; this is expected until a second provider (e.g., Pinnacle via OddsAPI) is added.
- SGO API requires explicit `leagueID` per request (e.g., `'NBA'`, `'NFL'`). There is no "fetch all sports" endpoint. The slice 1 scheduler must specify which leagues to poll.
- SGO `devig_mode = 'FALLBACK_SINGLE_SIDED'` occurs when only one side (over or under) is available for a market. The schema and normalizer must handle this gracefully — partial records are valid, not errors.

---

## 4. Decision 2 — provider_offers Schema

### Table: provider_offers

### Columns:

| Column | Type | Nullable | Purpose |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | Primary key, `gen_random_uuid()` default |
| `provider_key` | `text` | NOT NULL | FK to `sportsbooks.id` (e.g., `'sgo'`) |
| `provider_event_id` | `text` | NOT NULL | Provider's external event identifier |
| `provider_market_key` | `text` | NOT NULL | Base market key with side suffix stripped (e.g., `'points-all-game-ou'`) |
| `provider_participant_id` | `text` | NULL | Provider's player/participant identifier (null for team/game markets) |
| `sport_key` | `text` | NULL | Sport identifier from provider (e.g., `'NBA'`); nullable because not all providers supply it inline |
| `line` | `numeric` | NULL | The prop/spread/total line value; null for moneylines |
| `over_odds` | `integer` | NULL | American odds for the over side; null if only one side available |
| `under_odds` | `integer` | NULL | American odds for the under side; null if only one side available |
| `devig_mode` | `text` | NOT NULL | `'PAIRED'` when both sides present, `'FALLBACK_SINGLE_SIDED'` when only one side available |
| `is_opening` | `boolean` | NOT NULL DEFAULT `false` | True if this row represents opening-line odds |
| `is_closing` | `boolean` | NOT NULL DEFAULT `false` | True if this row represents closing-line odds |
| `snapshot_at` | `timestamptz` | NOT NULL | Server-set timestamp when this snapshot was taken |
| `idempotency_key` | `text` | NOT NULL | Composite uniqueness key (see below) |
| `created_at` | `timestamptz` | NOT NULL DEFAULT `now()` | Row creation time |

### Idempotency key:

Composed as: `{provider_key}:{provider_event_id}:{provider_market_key}:{line_str}:{is_opening}:{is_closing}`

Where `line_str` = the line value as a string with 1 decimal place (e.g., `'22.5'`), or `'null'` if no line.

This key uniquely identifies a single market snapshot for a given provider/event/market/line/temporal-position combination. A partial index on `idempotency_key` where `idempotency_key IS NOT NULL` enforces uniqueness without requiring the key on every historical row.

### Snapshot semantics:

Upsert-in-place on `idempotency_key`. Each unique (provider, event, market, line, is_opening, is_closing) combination has one row. Re-running the ingestion for the same snapshot window updates the existing row — it does not append a new row. This keeps the table compact for slice 1 and avoids unbounded growth during development.

Append-new-row semantics (for time-series line movement tracking) is deferred to slice 2 or slice 3 when CLV tracking requires it.

### Foreign keys:

`provider_key` REFERENCES `public.sportsbooks(id)` — enforces that only registered providers can write to this table. Application layer must validate against the `sportsbooks` catalog before insert.

No FK to `events.id` in slice 1. The `provider_event_id` is the provider's own event identifier (e.g., SGO's `eventID`), not V2's internal `events.id`. Event linkage (matching provider events to V2 canonical events) is a slice 2 concern.

### Indexes:

1. `provider_offers_idempotency_key_idx` — UNIQUE partial index on `(idempotency_key)` WHERE `idempotency_key IS NOT NULL`
2. `provider_offers_provider_event_idx` — index on `(provider_key, provider_event_id)` — supports lookups by event across all markets
3. `provider_offers_snapshot_at_idx` — index on `(snapshot_at DESC)` — supports recency queries

### api_credit_log: deferred to slice 2

SGO has no credit cost. The `api_credit_log` table will be required when OddsAPI is added (slice 2). Building it in slice 1 adds schema complexity with no operational payoff. Deferral is safe because the contract explicitly states that any credit-bearing provider requires `api_credit_log` before activation.

---

## 5. Decision 3 — NormalizedProviderOffer Contract Type

### Lives in: `@unit-talk/contracts` — new file `packages/contracts/src/provider-offers.ts`, exported from `packages/contracts/src/index.ts`

### Fields:

| Field | Type | Purpose |
|---|---|---|
| `providerKey` | `string` | Provider identifier; must match `sportsbooks.id` FK |
| `providerEventId` | `string` | Provider's external event ID |
| `providerMarketKey` | `string` | Base market key (side suffix already stripped) |
| `providerParticipantId` | `string \| null` | Provider's player/entity ID; null for team/game markets |
| `sportKey` | `string \| null` | Sport identifier from provider (e.g., `'NBA'`) |
| `line` | `number \| null` | Prop/spread/total line value |
| `overOdds` | `number \| null` | American odds for over side |
| `underOdds` | `number \| null` | American odds for under side |
| `devigMode` | `'PAIRED' \| 'FALLBACK_SINGLE_SIDED'` | Data quality signal — whether both sides were available for pairing |
| `isOpening` | `boolean` | True if represents opening-line odds |
| `isClosing` | `boolean` | True if represents closing-line odds |
| `snapshotAt` | `string` | ISO 8601 timestamp of the snapshot |
| `idempotencyKey` | `string` | Composite key for upsert deduplication |

### Relationship to ProviderOfferSlim (domain-only):

`ProviderOfferSlim` lives in `@unit-talk/domain/signals/market-signals.ts` and is the analysis-layer type. It is intentionally minimal: only the fields needed for `computeSignalVector()` and related math. It has no persistence fields (`id`, `idempotencyKey`), no provider-identity fields (`providerEventId`, `providerMarketKey`, `devigMode`), and no FK enforcement.

`NormalizedProviderOffer` is the persistence-ready shape. It contains all fields needed to insert a row into `provider_offers`. The conversion path is:

`NormalizedProviderOffer → stored in provider_offers → queried back → projected to ProviderOfferSlim → fed to computeSignalVector()`

`NormalizedProviderOffer` is a superset of `ProviderOfferSlim`. A pure adapter function (in domain or in the ingestor) converts `NormalizedProviderOffer[]` to `ProviderOfferSlim[]` for math consumption. This conversion is a projection, not a transformation — it simply selects the relevant fields.

### Relationship to BookOffer (math input):

`BookOffer` lives in `@unit-talk/domain/probability/devig.ts` and is the weighted math input to `computeConsensus()`. It requires `bookProfile` and `liquidityTier` (derived from `BOOK_PROFILES` by `providerKey`) and `dataQuality` (derived from `devigMode`: `PAIRED` → `'good'`, `FALLBACK_SINGLE_SIDED` → `'partial'`).

The mapping chain is:
`NormalizedProviderOffer → ProviderOfferSlim (signal math) + BookOffer (consensus math)`

Both conversions are pure projections with enrichment from `getBookProfile()`. Neither `ProviderOfferSlim` nor `BookOffer` should be stored in the DB — they are computation inputs only.

---

## 6. Decision 4 — Write Ownership

### Chosen: Option A — New standalone app `apps/ingestor`

### Reasoning:

The writer_authority_contract.md states: "The API service is the only default writer for canonical business tables." The contract also states: "Background workers execute delegated authority; they do not invent new authority." A new `apps/ingestor` is not a violation of the single-writer rule — it is a new app that is explicitly granted write authority for the `provider_offers` table by this contract. This is the same pattern by which `apps/worker` has delegated authority to write `distribution_receipts` and `system_runs`.

Option B (route inside `apps/api`) was rejected because ingestion is a polling process, not a request handler. Adding a polling loop inside `apps/api` would conflate the HTTP server process with a background scheduler, create startup ordering issues, and violate the principle that `apps/api` handles synchronous business transactions (submissions, settlements). The ingestor has different failure modes (external API timeouts, provider downtime) that should not affect the submission API's health.

Option D (extend `apps/worker`) was rejected because distribution and ingestion are separate concerns with different polling frequencies, different failure domains, and different authorization surfaces. Coupling them creates a monolithic worker that becomes harder to test, deploy, and scale independently.

Option C (new worker alongside `apps/worker`) would work architecturally but is functionally identical to Option A — a new app — without the clarity of a dedicated `apps/ingestor` package with its own entry point, env vars, and tests.

### Constraint: V2 single-writer rule:

`apps/ingestor` is the sole writer to `provider_offers`. No other app reads-then-writes to `provider_offers`. `apps/api` and `apps/operator-web` may query `provider_offers` read-only. The ingestor does not write to any table owned by `apps/api` (submissions, picks, pick_lifecycle, etc.) — it writes only to `provider_offers`, which is owned by the ingestor as declared in `canonicalSchema`.

### Risks:

- A new app adds one more binary to the deployment surface. For a first slice this is acceptable — the app is a simple polling loop.
- The ingestor needs its own repository bundle. The `RepositoryBundle` in `@unit-talk/db` is currently scoped to the pick/submission pipeline. A `ProviderOfferRepository` interface must be added to `@unit-talk/db` alongside the existing repositories.
- `apps/ingestor` must fall back gracefully (log and skip, do not crash) if `SGO_API_KEY` is absent — mirrors the in-memory fallback pattern used by `apps/api` and `apps/worker`.

---

## 7. Decision 5 — Scheduling Model

### Chosen: Option B — `setInterval` loop inside `apps/ingestor` process (same pattern as distribution-worker.ts / runner.ts)

### Reasoning:

The distribution worker already demonstrates the exact pattern needed: a `runWorkerCycles()` function with configurable `maxCycles`, `pollIntervalMs`, and an injectable `sleep` function. This pattern is well-tested in V2, requires no new dependencies, and runs in-process without infrastructure additions. For slice 1, the ingestor polls on a configurable interval (default: every 5 minutes) for a configured set of leagues. The loop is terminated by `UNIT_TALK_INGESTOR_MAX_CYCLES` or runs indefinitely when max cycles is unset.

Option A (manual HTTP trigger) was not chosen for the default path because the primary use case is background ingestion, not operator-triggered ingestion. An HTTP trigger can be added in slice 2 as an operator surface if needed.

Option D (GitHub Actions scheduled workflow) was rejected because it requires an external cron infrastructure, introduces network latency for Supabase access from CI runners, and cannot be easily tested locally.

Option E (Temporal) was rejected. Temporal is listed as T1 in the readiness checklist (item 5.4) and has not been integrated. Using it for a first-slice ingestion loop would be gross overengineering. It can be adopted in a future slice once the pipeline complexity justifies it.

### Mechanism:

`apps/ingestor/src/ingestor-runner.ts` — mirrors `apps/worker/src/runner.ts`. Accepts `IngestorRunnerOptions` with `leagues`, `pollIntervalMs`, `maxCycles`, `sleep`. Each cycle calls `ingestLeague(league, apiKey, repo)` for each configured league, recording a `system_runs` row per cycle. The entry point (`apps/ingestor/src/index.ts`) reads env vars and starts the loop.

### Risks:

- If the process crashes mid-cycle, the partial ingest is not retried until the next cycle. This is acceptable for slice 1 — data freshness, not strict delivery, is the goal.
- Poll interval of 5 minutes means data can be up to 5 minutes stale at any moment. For line movement detection (a future slice concern), this may require reduction.

---

## 8. Risks and Tradeoffs

| Risk | Severity | Mitigation |
|---|---|---|
| SGO API unavailable / unauthorized | Medium | Ingestor logs and skips; does not crash; `system_runs` records the failure |
| SGO `FALLBACK_SINGLE_SIDED` rows unusable for consensus math | Low | `devigMode` flag explicitly marks these; math layer (`computeConsensus`) will reject single-sided inputs via `INSUFFICIENT_BOOKS` |
| `provider_offers` grows unbounded if upsert logic is wrong | Medium | Unique partial index on `idempotency_key` prevents duplicates; integration test verifies re-run does not increase row count |
| `provider_key` value not in `sportsbooks` table | Low | Application-layer check before insert; FK constraint in schema as hard backstop |
| `apps/ingestor` adds deployment complexity | Low | For local dev, a simple `tsx apps/ingestor/src/index.ts` invocation suffices; no Docker changes required for slice 1 |
| Type-check breakage if `NormalizedProviderOffer` is added to `@unit-talk/contracts` without updating the contracts package exports | Low | `index.ts` export line must be added; covered by `pnpm type-check` gate |
| Event linkage (SGO `eventID` vs V2 `events.id`) not resolved in slice 1 | Medium | The `events` table FK is intentionally deferred; `provider_event_id` is stored as a plain text field in slice 1; linkage is a slice 2 contract item |
| No `api_credit_log` means OddsAPI cannot be safely activated | Intended | `api_credit_log` is an explicit slice 2 prerequisite; OddsAPI is blocked until the contract for slice 2 is written |

---

## 9. Final Recommendation

The first provider ingestion slice should be narrowly scoped: add the `provider_offers` migration, ratify the `NormalizedProviderOffer` type in `@unit-talk/contracts`, create `apps/ingestor` as a standalone app with a simple polling loop, and implement a V2-native SGO fetch → pair → normalize → upsert pipeline. The existing math layer (`computeConsensus`, `computeSignalVector`) can consume this data immediately via a projection adapter — no math changes are required. The slice is self-contained and delivers independently verifiable DB rows with a passing `pnpm verify`. OddsAPI, credit logging, event linkage, and Temporal orchestration are all explicitly deferred to subsequent contracts. This approach respects V2's single-writer discipline, does not touch the submission/promotion/distribution pipeline, and establishes the canonical foundation that all future market-intelligence features depend on.
