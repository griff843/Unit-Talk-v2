# Event Identity Contract

**Status:** RATIFIED (current behavior) — DECISION PENDING (cross-provider reconciliation)  
**Authority:** Runtime (`apps/ingestor/src/ingest-odds-api.ts`, `apps/ingestor/src/entity-resolver.ts`)  
**Updated:** 2026-04-03  
**Linear:** UTV2-309

---

## 1. Current Behavior

### How events are identified today

| Table | Key | Set by |
|-------|-----|--------|
| `events.external_id` | Provider-scoped event ID | Ingestor at upsert time |
| `events.id` | UUIDs (canonical) | DB on insert |

**SGO events:** The SGO normalizer sets `externalId` to the SGO-native event identifier. Team participants are resolved to canonical `participants` rows before linking via `event_participants`.

**Odds API events:** `resolveOddsApiEvents()` in `ingest-odds-api.ts` calls `repositories.events.upsertByExternalId({ externalId: event.id, ... })`. The `event.id` is the Odds API's own identifier (e.g. `"basketball_nba_202604..."`).

### The gap: no cross-provider identity link

Both providers have their own event IDs for the same real-world game. Today there is no deduplication or linking between them:

- A Nuggets vs Jazz game on 2026-04-03 has one SGO event ID and one Odds API event ID
- Both are stored as separate rows in `events` with different `external_id` values
- `provider_offers` rows reference `providerEventId` (the provider-scoped string), not the canonical `events.id`
- Picks submitted via Smart Form carry one `eventId` (the canonical UUID), resolved from whichever provider was browsed first

**Current impact:** Intelligence services (`devigging`, `realEdge`) match offers to picks via `providerEventId` on `provider_offers`. If the pick was submitted with an SGO-derived canonical `eventId` but Odds API offers were stored under a different `externalId`, the match fails → `deviggingResult = null`, `kellySizing = null`.

---

## 2. Authoritative Event Identity Rules (Current)

1. **Canonical event identity is the `events.id` UUID.** All downstream references (picks, event_participants, distribution) must use this UUID.
2. **`events.external_id` is provider-scoped.** It is unique per provider, not globally unique.
3. **Upsert is idempotent by `(external_id)`**. Two upserts with the same `external_id` produce one row.
4. **Two providers for the same real-world game = two separate `events` rows today.** This is the current behavior. It is not a bug to fix casually.
5. **Picks carry one `eventId`.** The canonical UUID comes from whichever provider's event the capper browsed. This ID is fixed at submission time.

---

## 3. Player-Prop Identity (Current Gap)

The Odds API ingest currently fetches only `['h2h', 'spreads', 'totals']`. No player-prop market keys are fetched. As a result:

- Odds API player-prop offers do not exist in `provider_offers`
- Player participants for team-side markets are canonicalized (team name matching against `participants` table)
- Player participants for player-prop markets have no Odds API-sourced canonicalization path

**SGO player-prop participants:** Resolved via `entity-resolver.ts` which does name-matching against the `participants` table and creates participants on first encounter.

---

## 4. Decision Required Before Implementing Reconciliation

Before UTV2-308 (player-prop canonicalization) or cross-provider event deduplication can proceed, the following architecture decisions must be made:

### Decision A — Cross-provider event identity strategy

| Option | Description | Risk |
|--------|-------------|------|
| A1: Canonical `events` row per real-world game | Upsert by matchup key (`sport + date + teams`), merge provider IDs into metadata | T1: migration required, offer linking changes |
| A2: Provider-scoped `events` + cross-reference table | Keep current rows, add `event_provider_links(canonical_event_id, provider_key, provider_event_id)` | T1: new table, no migration of existing data needed |
| A3: No structural change — match offers to picks via provider event key at query time | Keep current behavior, improve offer-to-pick matching in intelligence services to try multiple provider keys | T2: no migration, isolated change |

**Current production path blocks A1 and A2 without explicit PM approval.** A3 is T2 and executable without migration.

### Decision B — Player-prop participant canonicalization strategy

| Option | Description | Risk |
|--------|-------------|------|
| B1: Deterministic name matching | Map Odds API player display names to `participants` rows using same `namesMatch()` logic used for teams | Codex-safe if scope is explicit |
| B2: Create participants on first encounter | Same pattern as SGO entity-resolver — create participant row when name is not found | T2: adds write path in Odds API ingest |
| B3: Manual mapping table | Static map of known player name variants → canonical IDs | Low risk, high maintenance |

---

## 5. This Contract Ratifies

1. Current identity behavior is correct-by-design, not a bug
2. `events.external_id` is provider-scoped and not globally unique
3. No cross-provider deduplication currently exists
4. Player-prop Odds API offers are not ingested today
5. Implementing either reconciliation strategy requires a separate approved issue (this issue is the contract — not the implementation)

---

## 6. What UTV2-308 Can Proceed On

UTV2-308 (Canonicalize Odds API player-prop participants) can proceed within these bounds:

- **Allowed:** Add player-prop market keys to Odds API fetch, use deterministic name-matching (Option B1) against existing `participants` rows
- **Not allowed:** Create new `participants` rows from Odds API player names without explicit PM approval (that is Option B2, which widens canonical data)
- **Not allowed:** Change `events.external_id` semantics or add cross-reference tables (those are Options A1/A2)
- **Required:** Preserve manual fallback — unresolved player names must not block submission

UTV2-308 implementation is gated on this contract being ratified. This is now ratified for Option B1 scope.
