# T1 Contract: Provider Ingestion — SGO Primary

> Tier: T1 (Schema change + external API integration = high risk)
> Contract status: Ratified
> Produced: 2026-03-25
> Ratified: 2026-03-25
> Supersedes: none
> Depends on: migration 008 (reference_data_foundation), @unit-talk/contracts, @unit-talk/db

---

## 1. Objective

This contract authorizes and defines the first provider ingestion slice for Unit Talk V2. The slice delivers an end-to-end pipeline: SGO API fetch → over/under pair normalization → persistence to a new `provider_offers` table. The output feeds the existing domain math layer (`computeConsensus`, `computeSignalVector`) with real multi-book odds data for the first time in V2.

---

## 2. Why This Matters

The domain math layer (devigging, CLV computation, consensus probability, market signals) is fully implemented and tested but has never received live data. Every downstream intelligence capability — automated pick grading, CLV tracking, line movement detection, multi-book consensus signals — is blocked until a live data inbound path exists. This slice unblocks items 4.1 through 4.8 in the production readiness checklist. SGO is chosen as the primary first provider because it has zero API credit cost, is already registered in V2's reference catalog, and its API shape is well-characterized. The schema and contract type established in this slice are provider-agnostic — OddsAPI and future providers will write to the same `provider_offers` table using the same `NormalizedProviderOffer` type.

---

## 3. Scope

The following are in scope for this contract:

1. **Migration 009** — `provider_offers` table with idempotency key, FK to `sportsbooks`, and covering indexes
2. **`NormalizedProviderOffer` type** — new export from `@unit-talk/contracts` in `packages/contracts/src/provider-offers.ts`
3. **`ProviderOfferRepository` interface and `InMemoryProviderOfferRepository` + `DatabaseProviderOfferRepository` implementations** — added to `@unit-talk/db`
4. **`apps/ingestor`** — new standalone app; entry point, runner loop, SGO fetcher, normalizer
5. **SGO fetch → pair → normalize pipeline** — V2-native; no legacy code ported
6. **`SGO_API_KEY` env var** — added to `.env.example` and documented
7. **`system_runs` integration** — ingestor records a `system_runs` row per ingestion cycle
8. **Unit tests** — minimum 4 new tests; `pnpm verify` must pass; test count must not decrease
9. **`canonicalSchema` update** — `provider_offers` table added to `packages/db/src/schema.ts` with `owner: 'ingestor'`

---

## 4. Non-Goals

The following are explicitly out of scope for this contract:

- OddsAPI integration (requires separate slice 2 contract)
- `api_credit_log` table (required before OddsAPI; deferred to slice 2)
- `offer_quarantine` table (deferred — no quarantine path in slice 1)
- Event linkage (matching `provider_event_id` to V2 `events.id` — slice 2 concern)
- Multi-provider fallback routing (slice 2)
- CLV computation wiring to live data (slice 3+)
- Auto-settlement from ingested feed data (requires separate ratified contract; feed settlement guard in settlement-service.ts remains in place)
- Redis caching layer (deferred — no caching infrastructure in V2)
- Circuit breakers or rate limit coordination (deferred to T3)
- Temporal workflow integration (deferred — not yet ratified for V2)
- Any changes to the pick submission, promotion, distribution, or settlement pipeline
- Any write surface added to `apps/operator-web`

---

## 5. Current Truth

What exists in V2 today:

| Artifact | State | Location |
|---|---|---|
| `sportsbooks` table with SGO row | exists (migration 008) | DB |
| `BOOK_PROFILES['sgo']` | exists | `packages/domain/src/market/book-profiles.ts` |
| `V1_REFERENCE_DATA` sportsbooks: SGO | exists | `packages/contracts/src/reference-data.ts` |
| `isValidSportsbook('sgo')` returns true | exists | `packages/contracts/src/reference-data.ts` |
| `ProviderOfferSlim` interface | exists (analysis-only) | `packages/domain/src/signals/market-signals.ts` |
| `BookOffer` interface | exists (math input only) | `packages/domain/src/probability/devig.ts` |
| `computeConsensus()` | exists, tested | `packages/domain/src/probability/devig.ts` |
| `computeSignalVector()` | exists, tested | `packages/domain/src/signals/market-signals.ts` |
| `NormalizedProviderOffer` type | does not exist | — |
| `provider_offers` table | does not exist | — |
| `SGO_API_KEY` env var | does not exist | — |
| `apps/ingestor` | does not exist | — |
| Any ingestion service, fetcher, or handler | does not exist | — |

---

## 6. Architecture Decisions

All five decisions are documented and reasoned in `docs/ai_context/PROVIDER_INGESTION_DECISIONS.md`. Summary:

| Decision | Choice |
|---|---|
| Primary provider | SGO (zero credit cost, already cataloged in V2) |
| Secondary provider | OddsAPI — deferred to slice 2 |
| `provider_offers` schema | Upsert-in-place; idempotency key = `provider_key:event_id:market_key:line:is_opening:is_closing`; FK to `sportsbooks`; no FK to `events` in slice 1 |
| `NormalizedProviderOffer` location | `@unit-talk/contracts` — new file `packages/contracts/src/provider-offers.ts` |
| Write ownership | New `apps/ingestor` — standalone app with explicit delegated write authority for `provider_offers` only |
| Scheduling | `setInterval` loop in `apps/ingestor` — same pattern as `apps/worker/src/runner.ts`; configurable via env vars |

---

## 7. Required Schema Changes

### Migration 009: provider_offers

File: `supabase/migrations/202603200009_provider_offers.sql`

```sql
-- Migration 009: provider_offers table
-- Description: Canonical storage for multi-provider odds snapshots.
--   Provider-agnostic design. Slice 1 wires SGO only.
--   FK to sportsbooks ensures only registered providers write here.
--   Idempotency key prevents duplicate rows on re-ingest.
-- Rollback: DROP TABLE public.provider_offers CASCADE;

CREATE TABLE public.provider_offers (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key           text        NOT NULL REFERENCES public.sportsbooks(id),
  provider_event_id      text        NOT NULL,
  provider_market_key    text        NOT NULL,
  provider_participant_id text       NULL,
  sport_key              text        NULL,
  line                   numeric     NULL,
  over_odds              integer     NULL,
  under_odds             integer     NULL,
  devig_mode             text        NOT NULL CHECK (devig_mode IN ('PAIRED', 'FALLBACK_SINGLE_SIDED')),
  is_opening             boolean     NOT NULL DEFAULT false,
  is_closing             boolean     NOT NULL DEFAULT false,
  snapshot_at            timestamptz NOT NULL,
  idempotency_key        text        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Unique partial index on idempotency_key — prevents duplicates on re-ingest
CREATE UNIQUE INDEX provider_offers_idempotency_key_idx
  ON public.provider_offers (idempotency_key);

-- Lookup by provider + event — used by future signal computation queries
CREATE INDEX provider_offers_provider_event_idx
  ON public.provider_offers (provider_key, provider_event_id);

-- Recency queries
CREATE INDEX provider_offers_snapshot_at_idx
  ON public.provider_offers (snapshot_at DESC);
```

### Env vars to add to .env.example

```
SGO_API_KEY=
UNIT_TALK_INGESTOR_LEAGUES=NBA,NFL,MLB,NHL
UNIT_TALK_INGESTOR_POLL_MS=300000
UNIT_TALK_INGESTOR_MAX_CYCLES=1
UNIT_TALK_INGESTOR_AUTORUN=false
```

`SGO_API_KEY` — required for live ingestion; if absent the ingestor must log a warning and skip (do not crash).
`UNIT_TALK_INGESTOR_LEAGUES` — comma-separated list of SGO league IDs to poll per cycle.
`UNIT_TALK_INGESTOR_POLL_MS` — default 300000 (5 minutes).
`UNIT_TALK_INGESTOR_MAX_CYCLES` — default 1 for dev/CI; unset or 0 for infinite production loop.
`UNIT_TALK_INGESTOR_AUTORUN` — default false; set to true for production deploy.

---

## 8. Required Contract Changes

### @unit-talk/contracts — NormalizedProviderOffer

New file: `packages/contracts/src/provider-offers.ts`

Export from: `packages/contracts/src/index.ts` (add `export * from './provider-offers.js';`)

Fields:

```typescript
export type DevigMode = 'PAIRED' | 'FALLBACK_SINGLE_SIDED';

export interface NormalizedProviderOffer {
  providerKey: string;           // FK to sportsbooks.id (e.g., 'sgo')
  providerEventId: string;       // Provider's external event ID
  providerMarketKey: string;     // Base market key, side suffix stripped (e.g., 'points-all-game-ou')
  providerParticipantId: string | null;  // Provider's player/entity ID; null for team/game markets
  sportKey: string | null;       // Sport identifier (e.g., 'NBA'); null if not provided inline
  line: number | null;           // Prop/spread/total line value; null for moneylines
  overOdds: number | null;       // American odds for over side
  underOdds: number | null;      // American odds for under side
  devigMode: DevigMode;          // Data quality signal
  isOpening: boolean;
  isClosing: boolean;
  snapshotAt: string;            // ISO 8601 timestamp
  idempotencyKey: string;        // Composite key for upsert deduplication
}

export interface ProviderOfferInsert extends NormalizedProviderOffer {
  // Identical to NormalizedProviderOffer — used to signal insert intent
}
```

`DevigMode` distinguishes rows where both sides were available for devigging (`PAIRED`) from rows where only one side was present (`FALLBACK_SINGLE_SIDED`). The math layer uses this to assign `dataQuality` in `computeConsensus()`.

---

## 9. Normalization Requirements

### SGO API → NormalizedProviderOffer mapping

The SGO API returns event-keyed odds objects. The V2-native normalization pipeline is:

1. **Fetch** — `GET https://api.sportsgameodds.com/v2/events` with `apiKey`, `leagueID`, `startsAfter`, `startsBefore`, `includeOpposingOdds: true`, `oddsAvailable: true`
2. **Flatten** — iterate event odds objects; extract one row per market key with direction (`over`/`under`), line, and single odds value
3. **Pair** — group by `(eventID, playerName ?? '_', statType, lineStr)` key; match over and under rows within each group
4. **Normalize** — map each paired prop to `NormalizedProviderOffer`

Required transformations:
- Strip `-over` or `-under` suffix from `marketKey` to produce `providerMarketKey`
- Parse `line` to `number` with `isFinite` guard; null if unparseable
- Map odds to American integer (SGO returns American odds directly)
- Set `devigMode = 'PAIRED'` when both `overOdds` and `underOdds` are non-null; `'FALLBACK_SINGLE_SIDED'` otherwise
- Set `isOpening = false` and `isClosing = false` for all slice 1 rows (SGO slice 1 fetches current/live odds only; historical open/close ingestion is deferred)
- Set `snapshotAt` to the server timestamp at fetch time (not client `new Date()` — pass from the ingestor's run context)
- Compose `idempotencyKey = [providerKey, providerEventId, providerMarketKey, lineStr, isOpening, isClosing].join(':')`
  where `lineStr = line != null ? line.toFixed(1) : 'null'`

### Handling of missing over/under pairs:

Rows with both `overOdds === null` AND `underOdds === null` must be skipped — they carry no data. Rows with exactly one side non-null are valid; record them with `devigMode = 'FALLBACK_SINGLE_SIDED'`. The math layer will reject them for consensus (requires both sides) but they can be used for signal features that accept partial data.

### Devig mode flag requirement:

`devigMode` is required on every row — it is NOT NULL in the schema. This field enables the consumer math layer to distinguish high-quality paired rows from partial rows without re-examining the odds columns.

---

## 10. Persistence and Idempotency Requirements

### Upsert behavior:

The repository's `upsertBatch(offers: NormalizedProviderOffer[])` method must:
1. Compose the idempotency key for each offer
2. Issue an `INSERT ... ON CONFLICT (idempotency_key) DO UPDATE SET (over_odds, under_odds, devig_mode, snapshot_at) = (EXCLUDED.over_odds, EXCLUDED.under_odds, EXCLUDED.devig_mode, EXCLUDED.snapshot_at)`
3. Return the count of rows inserted and rows updated

### Idempotency key composition:

`{providerKey}:{providerEventId}:{providerMarketKey}:{lineStr}:{isOpening}:{isClosing}`

Where `lineStr = line != null ? line.toFixed(1) : 'null'` and `isOpening`/`isClosing` are the boolean values as strings (`'true'`/`'false'`).

### What a re-run must NOT do:

A second invocation for the same league within the same snapshot window must not create new rows. The total row count for `provider_key = 'sgo'` must be stable across re-runs for the same data. This is verifiable: run ingest twice in succession, assert row counts are equal.

### Snapshot semantics:

Slice 1 uses upsert-in-place. Each (provider, event, market, line, is_opening, is_closing) combination has exactly one row at any given time. The `snapshot_at` timestamp on that row reflects the most recent successful ingest.

---

## 11. Ownership and Runtime Boundaries

### Which app writes:

`apps/ingestor` is the sole writer to `provider_offers`. This is a new app with explicitly delegated write authority granted by this contract.

### How the single-writer rule is respected:

`apps/ingestor` writes ONLY to `provider_offers` and `system_runs`. It does not write to picks, submissions, outbox, or any other table owned by `apps/api` or `apps/worker`. The `ProviderOfferRepository` interface will be added to `@unit-talk/db`'s `repositories.ts` but the `RepositoryBundle` interface used by `apps/api` will NOT include it — the ingestor has its own bundle type (`IngestorRepositoryBundle`) containing only `providerOffers` and `runs`.

### What other apps may read vs write:

| App | `provider_offers` access |
|---|---|
| `apps/ingestor` | Write (upsertBatch) + Read for verification |
| `apps/api` | Read-only (future: feed into domain-analysis-service) |
| `apps/operator-web` | Read-only (future: operator snapshot) |
| `apps/worker` | No access |
| `apps/smart-form` | No access |

---

## 12. Scheduling Approach

### Mechanism chosen:

`setInterval`-based polling loop inside `apps/ingestor` process. Mirrors the `runWorkerCycles` pattern in `apps/worker/src/runner.ts`. The ingestor runner accepts configurable `leagues`, `pollIntervalMs`, `maxCycles`, and an injectable `sleep` function for test isolation.

### Poll frequency for slice 1:

Default: 5 minutes (300,000 ms), configurable via `UNIT_TALK_INGESTOR_POLL_MS`. For development, `UNIT_TALK_INGESTOR_MAX_CYCLES=1` runs one cycle and exits. For production, `UNIT_TALK_INGESTOR_AUTORUN=true` with no max cycles runs indefinitely.

### Leagues/sports in scope for slice 1:

Default: `NBA,NFL,MLB,NHL` — configurable via `UNIT_TALK_INGESTOR_LEAGUES`. The SGO league identifiers are uppercase strings matching V2's `sports.id` values (NBA, NFL, MLB, NHL). The ingestor must validate each configured league against the known SGO league map before making API calls.

---

## 13. Verification and Proof Requirements

### pnpm verify gate:

`pnpm verify` must exit 0. Test count must not decrease from the current baseline (83 tests as of Week 12 close). At minimum 4 new tests are required.

### Independent verification checklist:

After implementation, the following must be independently verified against live DB (Supabase MCP or direct query):

1. Migration 009 applied: `provider_offers` table exists with all required columns
2. `provider_offers_idempotency_key_idx` unique index exists
3. SGO ingest run completed: at least 1 row exists with `provider_key = 'sgo'`
4. Row has valid `snapshot_at` (server-set, not null, within 10 minutes of run time)
5. `devig_mode` values are only `'PAIRED'` or `'FALLBACK_SINGLE_SIDED'` — no other values
6. Idempotency proven: run ingest twice; row count before and after second run is identical
7. FK constraint enforced: attempt insert with `provider_key = 'invalid_provider'` — must fail with FK violation
8. `system_runs` row recorded for the ingestion cycle with `run_type = 'ingestor.cycle'` and `status = 'succeeded'`
9. `pnpm type-check` passes with `NormalizedProviderOffer` exported from `@unit-talk/contracts`
10. `NormalizedProviderOffer` fields are distinct from `ProviderOfferSlim` — `idempotencyKey` and `providerEventId` must not exist on `ProviderOfferSlim`

### What proves idempotency:

```
# Run 1
SELECT count(*) FROM provider_offers WHERE provider_key = 'sgo';
-- Record count C1

# Run ingest again (same league, same window)
SELECT count(*) FROM provider_offers WHERE provider_key = 'sgo';
-- Record count C2

# Assert: C1 == C2
```

### What proves correct normalization:

1. Select any row where `devig_mode = 'PAIRED'` — assert `over_odds IS NOT NULL AND under_odds IS NOT NULL`
2. Select any row where `devig_mode = 'FALLBACK_SINGLE_SIDED'` — assert `(over_odds IS NULL) != (under_odds IS NULL)` (exactly one side present)
3. Assert `provider_market_key` does not end with `-over` or `-under` — the side suffix must be stripped
4. Assert `line` is numeric where expected (player prop rows must have a line value)

### What proves the math layer can consume the data:

Run the following projection in a unit test or manual check:
1. Query a set of `PAIRED` rows for a single event from `provider_offers`
2. Project to `ProviderOfferSlim[]` (fields: `provider`, `line`, `over_odds`, `under_odds`, `snapshot_at`, `is_opening`, `is_closing`)
3. Call `computeSignalVector(openingOffers, closingOffers, allOffers)` — must return a valid `SignalVector` without throwing

### Rollback criteria:

Rollback is triggered if any of the following occur:
- `pnpm verify` fails after migration 009 is applied
- `provider_offers` FK constraint causes unexpected failures in unrelated app tests
- Type errors are introduced in `@unit-talk/contracts` that break downstream packages
- The ingestor crashes on empty API response (must log and return gracefully)

### How to rollback cleanly:

1. Revert all code changes (git revert or reset)
2. Run `DROP TABLE public.provider_offers CASCADE;` on live DB
3. Remove `SGO_API_KEY` and ingestor env vars from `.env.example`
4. Confirm `pnpm verify` returns to baseline pass state

---

## 14. Minimum Implementation Slice

### The exact bounded slice Codex should implement:

This contract defines a single implementation slice. Nothing in this slice should be widened without a contract amendment.

### Files to create:

| File | Purpose |
|---|---|
| `supabase/migrations/202603200009_provider_offers.sql` | Migration 009 |
| `packages/contracts/src/provider-offers.ts` | `NormalizedProviderOffer`, `ProviderOfferInsert`, `DevigMode` types |
| `apps/ingestor/package.json` | New app package |
| `apps/ingestor/src/index.ts` | Entry point (reads env, starts runner) |
| `apps/ingestor/src/ingestor-runner.ts` | `runIngestorCycles()` — mirrors runner.ts pattern |
| `apps/ingestor/src/sgo-fetcher.ts` | V2-native SGO fetch + flatten + pair pipeline (pure — no HTTP in tests) |
| `apps/ingestor/src/sgo-normalizer.ts` | `normalizeSGOPairedProp()` → `NormalizedProviderOffer` |
| `apps/ingestor/src/ingest-league.ts` | `ingestLeague(league, apiKey, repo, runRepo)` — pure, testable |
| `apps/ingestor/src/ingestor.test.ts` | Unit tests |
| `apps/ingestor/tsconfig.json` | TypeScript config (extends root) |

### Files to modify:

| File | Change |
|---|---|
| `packages/contracts/src/index.ts` | Add `export * from './provider-offers.js';` |
| `packages/db/src/repositories.ts` | Add `ProviderOfferRepository` interface and `ProviderOfferUpsertInput` type |
| `packages/db/src/runtime-repositories.ts` | Add `InMemoryProviderOfferRepository` and `DatabaseProviderOfferRepository` |
| `packages/db/src/schema.ts` | Add `provider_offers` to `canonicalSchema` with `owner: 'ingestor'` |
| `packages/db/src/index.ts` | Export new repository types |
| `.env.example` | Add `SGO_API_KEY=`, `UNIT_TALK_INGESTOR_LEAGUES=NBA,NFL,MLB,NHL`, `UNIT_TALK_INGESTOR_POLL_MS=300000`, `UNIT_TALK_INGESTOR_MAX_CYCLES=1`, `UNIT_TALK_INGESTOR_AUTORUN=false` |
| `packages/db/src/database.types.ts` | Regenerated after migration 009 applied (`pnpm supabase:types`) |
| `tsconfig.json` (root) | Add `apps/ingestor` to project references |
| `package.json` (root) | Add `test:ingestor` script if needed; add ingestor to workspace |

### Tests required (minimum 4):

1. `normalizeSGOPairedProp` — PAIRED row produces correct `NormalizedProviderOffer` with stripped market key, numeric line, and correct idempotency key
2. `normalizeSGOPairedProp` — FALLBACK_SINGLE_SIDED row (only over side) produces correct `devigMode = 'FALLBACK_SINGLE_SIDED'`, `underOdds = null`
3. `InMemoryProviderOfferRepository.upsertBatch` — second upsert with same idempotency key does not create a new row (idempotency proof)
4. `ingestLeague` — empty API response returns gracefully with 0 inserted rows and does not throw
5. (Recommended) `normalizeSGOPairedProp` — row with both sides null is skipped (returns null or is filtered before upsert)

### Acceptance criteria:

- `pnpm verify` exits 0
- Test count is ≥ 87 (83 + 4 new minimum)
- `provider_offers` table exists in live Supabase with correct schema
- At least 1 SGO row in `provider_offers` after a live ingest run
- Re-run does not increase row count (idempotency)
- `NormalizedProviderOffer` is exported from `@unit-talk/contracts` and importable by `apps/ingestor`
- `ProviderOfferRepository` is exported from `@unit-talk/db`
- No type errors introduced in existing packages

---

## 15. Deferred Work

The following items are explicitly not part of this slice. Each requires its own contract before implementation:

| Item | Reason for deferral | Target tier |
|---|---|---|
| OddsAPI integration | Requires credit logging; separate provider adapter | T1 slice 2 |
| `api_credit_log` table | Required before any credit-bearing provider; no value for SGO | T1 slice 2 |
| `offer_quarantine` table | No quarantine path needed for slice 1; adds complexity | T1 slice 2 |
| Event linkage (`provider_event_id` → `events.id`) | Complex entity matching; not needed for math consumption | T1 slice 2 |
| Multi-provider fallback routing | Requires ≥2 providers active | T1 slice 2 |
| CLV tracking wired to live data | Requires event linkage + historical line storage | T1 slice 3 |
| `is_opening = true` / `is_closing = true` rows | Requires historical fetch mode; SGO supports via `includeOpenCloseOdds` param | T2 slice 2 |
| Append-new-row time-series semantics | Requires CLV tracking decision; schema change | T1 slice 3 |
| Redis caching layer | No caching infrastructure in V2 | T3 |
| Temporal workflow integration | Not yet ratified; overengineering for slice 1 | T1 (future) |
| Auto-settlement from feed data | Settlement feed guard remains in place; separate ratified contract required | T1 (future) |
| Operator dashboard surface for ingestion health | Requires operator-web contract amendment | T2 (future) |
