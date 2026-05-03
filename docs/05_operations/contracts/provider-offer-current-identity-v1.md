# provider_offer_current Identity Contract — v1

**Status:** APPROVED  
**Issue:** UTV2-771  
**Approved by:** PM (griff843)  
**Effective date:** 2026-05-03  
**Do not implement the new current-offer table until this contract is ratified.**

---

## 1. Purpose

This document is the canonical identity contract for `provider_offer_current`. It defines what makes an offer unique, the semantics of each identity dimension, how aliases and conflicts are handled, and what is explicitly out of scope. All implementations must conform to this contract.

---

## 2. Canonical Uniqueness Key

The identity of a current offer is the 5-tuple:

```
(provider_key, provider_event_id, provider_market_key, COALESCE(provider_participant_id, ''), COALESCE(bookmaker_key, ''))
```

**Strategy name:** `provider_event_market_participant_book`

This is the key used by:
- The `provider_offer_current` view (`DISTINCT ON` clause in migration `202604290003`)
- `buildProviderOfferIdentityKey()` in `apps/ingestor/src/provider-offer-staging.ts`
- The `provider_offers_current_identity_snapshot_idx` index

Within ties (same 5-tuple), the latest row is selected by `(snapshot_at DESC, created_at DESC, id DESC)`.

---

## 3. Field Semantics

### 3.1 `provider_key`
The data source identifier. A `text` FK to `sportsbooks.id`.

| Value | Meaning |
|-------|---------|
| `'sgo'` | Sports Game Odds API (primary provider) |
| `'odds-api'` | The Odds API (secondary provider) |

Each provider has its own event/market/participant ID namespace. IDs from different providers are never mixed without explicit normalization.

### 3.2 `provider_event_id`
The provider's external event identifier. Opaque string — semantics are provider-specific. This is **not** a canonical event ID; canonical event resolution is a downstream concern.

### 3.3 `provider_market_key`
The provider's market taxonomy key (e.g., `'points-all-game-ou'`). Opaque string from the provider's namespace. Canonical market resolution (alias lookup) happens in consumers, not in the identity contract.

### 3.4 `provider_participant_id`
The provider's player or participant identifier. `NULL` for event-scoped markets (totals, spreads). Stored as `COALESCE(provider_participant_id, '')` in the identity key so `NULL` and `''` are treated identically.

### 3.5 `bookmaker_key`
The sportsbook identifier within the provider's data (e.g., `'pinnacle'`, `'draftkings'`). `NULL` when the provider does not disaggregate by book. Stored as `COALESCE(bookmaker_key, '')` in the identity key.

### 3.6 Line-side encoding
Over/under is encoded as `over_odds` and `under_odds` columns — not as a separate identity dimension. Both sides of a market share one identity row (the latest snapshot). This means a single identity row represents a complete two-sided offer.

---

## 4. Alias Handling

Alias resolution is the **consumer's responsibility**, not the identity contract's.

| Alias type | Where resolved |
|------------|----------------|
| Market key aliases | `system-pick-scanner.ts` — alias lookup before market universe upsert |
| Participant aliases | `system-pick-scanner.ts` — entity alias lookup before candidate upsert |
| Book aliases | Not currently resolved; `bookmaker_key` is used verbatim |
| Provider aliases | Not applicable; `provider_key` is canonical |

The identity contract stores raw provider strings. Canonical resolution never mutates the `provider_offers` table.

---

## 5. Conflict Behavior

### 5.1 `idempotency_key` (primary deduplication)
- **Format:** `{provider_key}:{provider_event_id}:{provider_market_key}:{provider_participant_id|''}:{bookmaker_key|''}:{snapshot_at_iso}`
- **Constraint:** `UNIQUE` on `provider_offers`
- **On conflict:** `DO NOTHING` — first write wins
- **Rationale:** Preserves the `is_opening` / `is_closing` flags set at first-write time. A duplicate snapshot at the same timestamp cannot overwrite an opening-line designation.

### 5.2 `provider_offer_current` view conflict
The view selects the single latest row per 5-tuple identity. If two rows share the same 5-tuple but differ in `snapshot_at`, the later timestamp wins. If `snapshot_at` ties, `created_at DESC` then `id DESC` breaks the tie deterministically.

### 5.3 Staging → merge conflict
During the staged merge path (`merge_provider_offer_staging_cycle` RPC), rows already present in `provider_offers` (by `idempotency_key`) are marked `'duplicate'` in staging and skipped. No update is performed on the existing row.

---

## 6. Scope Boundaries

The following are **explicitly excluded** from the identity contract. They are downstream concerns.

| Excluded | Reason |
|----------|--------|
| Sport/league semantics | `sport_key` is a denormalized annotation, not an identity dimension. Normalization is a separate step. |
| Line normalization | The `line` column is stored verbatim from the provider. Canonical line normalization is a consumer concern. |
| Canonical event ID | Provider event IDs are opaque. Canonical event resolution requires a separate entity-matching layer. |
| Canonical market ID | Provider market keys are opaque. Resolved via alias lookup in consumers. |
| Canonical player ID | Provider participant IDs are opaque. Resolved via entity alias lookup in consumers. |

---

## 7. Consumer Confirmation

### 7.1 System Pick Scanner (`apps/api/src/system-pick-scanner.ts`)
- Reads via `listOpeningCurrentOffers()` which queries `provider_offer_current`
- Uses the identity tuple to deduplicate candidates before `market_universe` upsert
- The 5-tuple identity is sufficient for candidate provenance — no additional identity fields required
- Alias resolution happens after identity lookup, not before

### 7.2 CLV Service (`apps/api/src/clv-service.ts`)
- Closes-line lookup uses `(provider_event_id, provider_market_key, provider_participant_id, bookmaker_key)` — a subset of the 5-tuple (provider_key is implicitly `'sgo'` for primary lookup)
- Fallback chain: Pinnacle → consensus → SGO opening → market_universe snapshot
- The identity is sufficient for CLV joins given the current fallback chain

---

## 8. Implementation Reference

| Artifact | Location |
|----------|----------|
| Table schema | `supabase/migrations/202603200009_provider_offers.sql` |
| `provider_offer_current` view | `supabase/migrations/202604290003_utv2_781_provider_offer_current_view.sql` |
| Identity index | `supabase/migrations/202604290004_utv2_781_provider_offer_current_indexes.sql` |
| `buildProviderOfferIdentityKey()` | `apps/ingestor/src/provider-offer-staging.ts` |
| `list_provider_offer_current_opening()` fn | `supabase/migrations/202604290005_utv2_781_provider_offer_current_opening_fn.sql` |
| Repository interface | `packages/db/src/repositories.ts` lines 597–687 |
| Types | `packages/db/src/types.ts` — `ProviderOfferRow`, `ProviderOfferCurrentRow` |

---

## 9. Change policy

This contract is versioned. Any change to the 5-tuple identity key, conflict behavior, or scope boundaries requires:

1. A new contract version (v2, v3, …) as a new file in this directory
2. A Linear issue with `kind:contract` label
3. PM approval before implementation begins
4. Migration + generated type refresh if the DB schema changes
