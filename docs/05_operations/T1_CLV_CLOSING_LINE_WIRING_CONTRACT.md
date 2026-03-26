# T1 Contract: CLV Closing Line Lookup & Settlement Wiring

> Tier: T1 (new migration, cross-package repository extension, settlement write path change)
> Contract status: **CLOSED** (2026-03-26)
> Produced: 2026-03-26
> Ratified: 2026-03-26 — schema audit complete; all prerequisites met
> Closed: 2026-03-26 — all proof items confirmed; migration 011 applied (Remote 202603200011); CLV live; operator route confirmed; starts_at confirmed
> Supersedes: none
> Depends on: T1 Feed Entity Resolution — CLOSED; T1 Provider Ingestion — CLOSED; `provider_offers` populated; `events` populated with entity resolution
> Authority: `docs/06_status/PROGRAM_STATUS.md` wins on conflict

---

## 1. Objective

Wire the existing CLV (Closing Line Value) domain math to live provider offer data so that every settled pick gets a computed CLV value. CLV is the single most important metric for evaluating capper quality — it measures whether a bettor consistently beat the closing line.

**The specific gap being closed:**

The domain math layer has `computeCLVForecastV2()` (tested, 4 tests) and `classifyLoss()` (tested, 11 tests) which consume `clv_at_bet` and `clv_at_close` values. But these values are currently **always 0** because:
1. No code looks up the closing line from `provider_offers` at settlement time
2. No code computes CLV from the looked-up closing line
3. No code writes CLV into `settlement_records.payload`
4. The settlement service reads CLV from `pick.metadata.lossAttribution` but that field is never populated

After this lane: when a pick is settled, the system looks up the closest provider offer before the event started, computes CLV by comparing the pick's odds to the closing line, and persists the result to `settlement_records.payload.clv`. The operator dashboard displays CLV in the pick detail view.

---

## 2. Schema Truth Audit Summary

### What exists

| Item | Current state |
|------|---------------|
| `computeCLVForecastV2()` | Tested (4 tests). Inputs: edge, movement_score, sharp_weight_score, sharp_direction, dispersion_score. Output: `{ clv_forecast: number }` clamped to [-1, +1]. |
| `classifyLoss()` | Tested (11 tests). Consumes `clv_at_bet`, `clv_at_close`. PRICE_MISS threshold: CLV < -3%. |
| `provider_offers` table | 800+ rows. Columns: `provider_event_id`, `provider_market_key`, `provider_participant_id`, `snapshot_at`, `over_odds`, `under_odds`, `line`, `is_closing`. Indexed: `(provider_key, provider_event_id)`, `(snapshot_at DESC)`. |
| `provider_offers.is_closing` | Column exists but **always `false`** — SGO normalizer hardcodes it. Cannot be used as a filter. |
| `events` table | 10+ rows. `external_id` = SGO provider event ID (opaque string). `event_date` = date only (no time component). `metadata` does NOT store `startsAt`. |
| `picks` table | Has `market`, `selection`, `line`, `odds`, `participant_id` (FK to participants). **No `event_id` column.** No direct link to events. |
| `settlement_records.payload` | `Json` (nullable). Currently stores `{ requestStatus, correction }` only. Ready to accept CLV fields. |
| `SettlementCreateInput.payload` | `Record<string, unknown>` — accepts arbitrary JSON. |
| `ProviderOfferRepository` | Two methods only: `upsertBatch()`, `listByProvider()`. **No closing-line lookup method.** |

### What's missing

| Gap | Required by this lane |
|-----|----------------------|
| Composite index for CLV lookups | Migration 011 |
| `ProviderOfferRepository.findClosingLine()` | New method |
| `events.metadata.starts_at` stored by entity resolver | Store the full ISO timestamp, not just the date |
| Pick-to-event join | `picks.participant_id` → `event_participants.participant_id` → `event_participants.event_id` → `events.external_id` → `provider_offers.provider_event_id` |
| CLV computation + write at settlement time | Settlement service extension |
| CLV display in operator pick detail | Operator-web extension |

---

## 3. Scope

### 3.1 Migration 011 — Composite Index for CLV Lookups

```sql
-- Migration 011: CLV closing line lookup index
-- Enables efficient lookup of the latest provider offer before event start time.
-- No new tables. No new columns. Index-only migration.

CREATE INDEX IF NOT EXISTS provider_offers_clv_lookup_idx
  ON provider_offers (provider_event_id, provider_market_key, provider_participant_id, snapshot_at DESC);
```

This index supports the query pattern: "find the latest offer for event X, market Y, participant Z before time T."

### 3.2 Store `starts_at` in `events.metadata`

Extend the entity resolver to store the full ISO timestamp in `events.metadata.starts_at`:

```typescript
metadata: {
  venue: event.venue ?? null,
  broadcast: event.broadcast ?? null,
  home_team_external_id: event.teams.home?.teamId ?? null,
  away_team_external_id: event.teams.away?.teamId ?? null,
  starts_at: event.startsAt ?? null,  // NEW — full ISO timestamp
}
```

This is a one-line addition to `apps/ingestor/src/entity-resolver.ts`. The `events.event_date` column is date-only (day precision); `starts_at` in metadata provides the exact game time needed for CLV cutoff.

### 3.3 `ProviderOfferRepository.findClosingLine()`

Add to the interface in `packages/db/src/repositories.ts`:

```typescript
findClosingLine(criteria: ClosingLineLookupCriteria): Promise<ProviderOfferRecord | null>;
```

```typescript
export interface ClosingLineLookupCriteria {
  providerEventId: string;        // maps to provider_offers.provider_event_id
  providerMarketKey: string;      // maps to provider_offers.provider_market_key
  providerParticipantId?: string | null;  // optional — null for game totals
  before: string;                 // ISO timestamp cutoff — typically event start time
}
```

**Query semantics:**
- `SELECT * FROM provider_offers WHERE provider_event_id = $1 AND provider_market_key = $2 AND snapshot_at <= $4 ORDER BY snapshot_at DESC LIMIT 1`
- If `providerParticipantId` is provided: add `AND provider_participant_id = $3`
- If `providerParticipantId` is null/undefined: add `AND provider_participant_id IS NULL`
- Returns the single most recent offer snapshot before the cutoff time
- Returns `null` if no matching offer exists (no-result is not an error)

**Why participant handling matters:** Game totals and moneylines have `provider_participant_id = NULL` in `provider_offers`. Player props have it set. The lookup must distinguish between "no participant filter" and "participant is explicitly null."

### 3.4 Pick-to-Event Resolution

At settlement time, the system must resolve which event a pick belongs to, in order to look up the closing line. The join path is:

```
picks.participant_id
  → event_participants.participant_id
    → event_participants.event_id
      → events.id / events.external_id
        → provider_offers.provider_event_id
```

This requires:
1. Pick has a `participant_id` (nullable FK to participants)
2. That participant is linked to an event via `event_participants`
3. The event has an `external_id` matching `provider_offers.provider_event_id`

**If the pick has no `participant_id` or no event link exists:** CLV lookup is skipped. `settlement_records.payload.clv` is written as `null`. This is not an error — it means the pick was submitted before entity resolution ran, or it's a market type not covered by the feed.

### 3.5 CLV Computation at Settlement Time

Add a `computeAndAttachCLV()` function in the settlement service (or a new `clv-service.ts` in `apps/api/src/`):

```typescript
export interface CLVResult {
  pickOdds: number;               // the odds on the pick at bet time
  closingOdds: number;            // the odds from the latest provider offer
  closingLine: number | null;     // the line value from the latest provider offer
  closingSnapshotAt: string;      // when the closing line was captured
  clvRaw: number;                 // raw CLV = pickImpliedProb - closingImpliedProb
  clvPercent: number;             // as percentage
  beatsClosingLine: boolean;      // clvRaw > 0
  providerKey: string;            // which provider's closing line was used
}
```

**Computation:**
1. Resolve pick → event (via participant join)
2. Get event start time from `events.metadata.starts_at` (falling back to `events.event_date + 'T23:59:59Z'` if metadata missing)
3. Call `ProviderOfferRepository.findClosingLine()` with the pick's market key, participant external_id, and event start time as cutoff
4. If no closing line found: return `null` (skip CLV)
5. Devig both sides using existing `devig()` from `packages/domain`
6. Compute `clvRaw = pickImpliedProb - closingImpliedProb`
7. Return `CLVResult`

### 3.6 Persist CLV to Settlement Record

In the settlement service, after recording the settlement record:

```typescript
// After recording settlement...
const clv = await computeAndAttachCLV(pick, repositories);
// Merge CLV into the settlement payload
const enrichedPayload = {
  ...existingPayload,
  clv: clv ?? null,
};
// Update the settlement record with enriched payload
await repositories.settlements.updatePayload(settlementRecordId, enrichedPayload);
```

Add `updatePayload(id: string, payload: Record<string, unknown>)` to `SettlementRepository` — a targeted update that only touches the `payload` column.

### 3.7 Operator Display

Extend `PickDetailView` in `apps/operator-web/src/server.ts`:

```typescript
export interface PickDetailView {
  // ... existing fields ...
  clv: CLVResult | null;  // NEW — extracted from settlement_records.payload.clv
}
```

When building `PickDetailView` in `getPickDetail()`, extract CLV from the effective settlement's payload:
- Find the effective settlement (latest in correction chain)
- Read `payload.clv` if present
- Set `clv: null` if no CLV was computed

No HTML dashboard change — CLV is on the JSON pick detail view only. HTML CLV summary is a future lane.

---

## 4. Non-Goals

- **No `is_closing` automation** — the SGO normalizer continues to set `is_closing = false`. The CLV lookup uses time-based proximity instead.
- **No multi-provider CLV consensus** — single provider (SGO) only. Second provider is a separate lane.
- **No CLV alerting or thresholds** — no "flag picks with CLV > X" automation.
- **No dedicated CLV column on `picks`** — CLV lives in `settlement_records.payload`. JSONB is sufficient for V1.
- **No CLV in HTML dashboard** — JSON pick detail only. HTML summary is a future lane.
- **No CLV batch backfill** — existing settled picks without CLV are not retroactively computed. Future maintenance lane.
- **No new tables** — all data flows through existing columns (`settlement_records.payload`, `events.metadata`).
- **No market key normalization changes** — the pick's `market` field is matched against `provider_offers.provider_market_key` using the existing format.
- **No Discord changes** — no bot modifications.

---

## 5. Implementation Surface

| File | Change |
|------|--------|
| `supabase/migrations/202603200011_clv_lookup_index.sql` | NEW — composite index |
| `apps/ingestor/src/entity-resolver.ts` | One-line: add `starts_at` to event metadata |
| `packages/db/src/repositories.ts` | Add `findClosingLine()` to `ProviderOfferRepository`; add `updatePayload()` to `SettlementRepository`; add `ClosingLineLookupCriteria` interface |
| `packages/db/src/runtime-repositories.ts` | `DatabaseProviderOfferRepository.findClosingLine()` implementation; `InMemoryProviderOfferRepository.findClosingLine()`; `DatabaseSettlementRepository.updatePayload()`; `InMemorySettlementRepository.updatePayload()` |
| `apps/api/src/clv-service.ts` | NEW — `computeAndAttachCLV()`, `CLVResult` interface, pick-to-event resolution, devig + CLV math |
| `apps/api/src/settlement-service.ts` | After recording settlement, call `computeAndAttachCLV()` and update payload |
| `apps/api/src/clv-service.test.ts` | NEW — tests for CLV computation, no-match handling, participant-less markets |
| `apps/operator-web/src/server.ts` | Add `clv` field to `PickDetailView`, extract from settlement payload |
| `apps/operator-web/src/server.test.ts` | Test CLV display in pick detail |

**Do not touch:**
- `packages/domain/src/**` — domain math is already complete; consume it, don't modify it
- `apps/smart-form/**` — no Smart Form changes
- `apps/worker/**` — no worker changes
- `apps/discord-bot/**` — no Discord changes
- `packages/db/src/database.types.ts` — migration 011 adds only an index; no type regen needed
- `packages/db/src/schema.ts` — no new enum values

---

## 6. Acceptance Criteria

| # | Criterion | Testable? |
|---|-----------|-----------|
| AC-1 | Migration 011 applied: `provider_offers_clv_lookup_idx` exists in live DB | ✅ Supabase MCP |
| AC-2 | `ProviderOfferRepository.findClosingLine()` returns the latest offer before cutoff time for a given event + market | ✅ Unit test |
| AC-3 | `findClosingLine()` returns `null` when no matching offer exists | ✅ Unit test |
| AC-4 | `findClosingLine()` correctly handles participant-less markets (game totals) vs. player props | ✅ Unit test |
| AC-5 | After settling a pick with a linked event and matching provider offers, `settlement_records.payload.clv` contains a `CLVResult` object | ✅ Integration test |
| AC-6 | CLV `beatsClosingLine` is `true` when pick odds are better than closing line | ✅ Unit test |
| AC-7 | When no closing line is found (no matching offer or no event link), `settlement_records.payload.clv` is `null` and settlement still succeeds | ✅ Unit test |
| AC-8 | `GET /api/operator/picks/:id` response includes `clv` field extracted from effective settlement payload | ✅ Integration test |
| AC-9 | Entity resolver stores `starts_at` in `events.metadata` from SGO `status.startsAt` | ✅ Unit test |
| AC-10 | `pnpm verify` exits 0; root test count ≥586 (no regression) + ≥8 net-new tests | ✅ CI |
| AC-11 | Existing settlement tests still pass — no regression in settlement write path | ✅ Existing tests |

---

## 7. Proof Requirements (T1)

Before Claude marks this sprint CLOSED, the following must be demonstrated:

1. **`pnpm verify` exits 0** with ≥8 net-new tests
2. **Migration 011 applied**: `provider_offers_clv_lookup_idx` confirmed in live DB
3. **Live settlement with CLV**: Settle a pick that has a linked event with matching provider offers. Show `settlement_records.payload.clv` contains non-null `CLVResult` with `closingOdds`, `clvRaw`, `beatsClosingLine`.
4. **No-match graceful fallback**: Settle a pick with no matching offers. Show `settlement_records.payload.clv` is `null` and settlement succeeds.
5. **Operator display**: `GET /api/operator/picks/:id` returns `clv` field for settled pick with CLV data.
6. **Entity resolver stores starts_at**: Query `events.metadata` for a resolved event — `starts_at` field present with ISO timestamp.
7. **Existing settlement tests pass**: No regression in settlement write path.

---

## 8. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Pick has no `participant_id` → no event link → no CLV | Medium | Graceful null — CLV is optional enrichment, not a settlement gate. |
| Market key mismatch between pick.market and provider_offers.provider_market_key | Medium | Log mismatch; return null. Future lane can add market key normalization mapping. |
| Event metadata.starts_at missing for events resolved before this lane | Low | Fallback: use `event_date + 'T23:59:59Z'` as cutoff. Next ingest cycle populates starts_at. |
| CLV computation adds latency to settlement path | Low | Single indexed query + math. Expected <50ms. |
| provider_offers has no data for the pick's market | Low | Return null. CLV is best-effort for V1. |

---

## 9. Rollback Plan

Migration 011 is index-only — safest possible rollback:

```sql
DROP INDEX IF EXISTS provider_offers_clv_lookup_idx;
```

Code rollback:
1. Revert `apps/api/src/clv-service.ts` — delete file
2. Revert settlement service changes — remove CLV call
3. Revert `packages/db/src/repositories.ts` — remove `findClosingLine()`, `updatePayload()`
4. Revert `packages/db/src/runtime-repositories.ts` — remove implementations
5. Revert `apps/ingestor/src/entity-resolver.ts` — remove `starts_at` from metadata
6. Revert `apps/operator-web/src/server.ts` — remove CLV from PickDetailView
7. `pnpm verify` — confirm 586 tests pass

Settlement records with `payload.clv` data are harmless — extra JSONB fields do not break existing consumers.

---

## 10. Deferred Items

| Item | When |
|------|------|
| `is_closing` automation (SGO normalizer marks actual closing lines) | Future enrichment lane — requires SGO feed semantics research |
| Multi-provider CLV consensus (compare SGO vs. OddsAPI closing lines) | After second provider integration |
| CLV summary in HTML dashboard (aggregate CLV stats) | Follow-on T2 lane — `GET /api/operator/recap` extension |
| CLV batch backfill (compute CLV for already-settled picks) | Maintenance script — not blocking |
| CLV alerting (flag picks with CLV > X at settlement) | Future T2 — requires alerting infrastructure |
| Dedicated `picks.clv` column (denormalized for fast queries) | When JSONB extraction becomes a performance issue |
| Market key normalization mapping (pick.market → provider_market_key) | Future T2 if mismatch rate is high |
