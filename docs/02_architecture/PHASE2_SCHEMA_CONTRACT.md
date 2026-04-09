# Phase 2 Schema Contract — Market Universe and Pick Candidates

**Version:** 1.0  
**Status:** AUTHORITATIVE  
**Date:** 2026-04-09  
**Governs:** UTV2-458, UTV2-459, UTV2-460, UTV2-461, UTV2-462, UTV2-463, UTV2-464  
**Supersedes:** none  
**Locked roadmap position:** Phase 2 — Universe + Candidate Foundation

---

## 1. Purpose

This contract defines the canonical Phase 2 schema and boundary rules for the first syndicate-machine foundation layer in Unit Talk V2.

Phase 2 exists to create a governed transition from raw provider offer data into a board-evaluation layer:

```text
provider_offers → market_universe → pick_candidates
```

This contract authorizes and constrains:

- the `market_universe` schema
- the `pick_candidates` schema
- the materialization relationship from `provider_offers`
- the board-scan relationship from `market_universe`
- the Phase 2 lifecycle and boundary rules
- the proof conditions required before Phase 3 may begin

This contract does **not** govern:

- Phase 3 model wiring
- Phase 4 selection / tiering
- Phase 5 governance / review queue / operator write controls
- Phase 6 feedback loop / model tuning / market-family trust loops

---

## 2. Architectural Boundaries (Hard Locks)

### 2.1 Candidate layer does not write to `picks` in Phase 2

`pick_candidates` is a separate evaluation layer and must not create, mutate, or back-fill `picks` in Phase 2.

Rules:
- `pick_candidates.pick_id` must remain `NULL` on all rows throughout Phase 2
- no Phase 2 service may insert into `picks` from `pick_candidates`
- no Phase 2 board scan may call submission, promotion, routing, settlement, or scanner pick creation logic

Any Phase 2 write from candidate flow into `picks` is a contract violation.

### 2.2 Model fields remain null in Phase 2

The following candidate fields are placeholders only:

- `model_score`
- `model_tier`
- `model_confidence`

Rules:
- all three fields are nullable
- all three fields must remain null throughout Phase 2
- no Phase 2 job may populate them
- Phase 3 is the first phase allowed to wire model output into these fields

### 2.3 Materializer outputs `market_universe` rows only

The Phase 2 materializer reads from `provider_offers` and writes to `market_universe`.

Rules:
- the materializer must not create `pick_candidates`
- the materializer must not create `picks`
- the materializer must not run model scoring
- the materializer must not perform final selection or ranking

### 2.4 Board scan outputs `pick_candidates` rows only

The Phase 2 board scan reads `market_universe` and writes `pick_candidates`.

Rules:
- the board scan must not create `picks`
- the board scan must not route to Discord
- the board scan must not call promotion or settlement flows
- the board scan may only apply coarse Phase 2 qualification logic

### 2.5 System scanner path is parallel and is not modified by Phase 2

The existing scanner path remains a parallel runtime path.

Rules:
- the system pick scanner continues to read from existing scanner/provider-offer logic and may continue to write directly to `picks`
- Phase 2 does not route the scanner through `market_universe`
- Phase 2 does not route the scanner through `pick_candidates`
- no existing scanner behavior is deprecated by this contract

### 2.6 Phase 3 gate

Phase 3 is blocked until UTV2-464 is complete and accepted.

Minimum gate:
- Phase 2 runtime proof and evidence bundle exists
- candidate/pick separation is proven by DB truth
- materializer idempotency is proven
- candidate generation is proven
- line movement logic is proven if implemented in Phase 2 scope

No model wiring begins before UTV2-464 is accepted.

---

## 3. Relationship Map

```text
provider_offers
  (raw provider market data, append-only, retained independently)
        │
        ▼  [Phase 2 — materializer]
market_universe
  (one canonical market opportunity row per natural key, upserted)
        │
        ▼  [Phase 2 — board scan]
pick_candidates
  (candidate evaluation layer, no pick conversion in Phase 2)
        │
        ▼  [Phase 4+ only]
picks

system-pick-scanner ───────────────→ picks
(parallel path, unchanged by Phase 2)
```

Important:
- `market_universe` must not have a live FK dependency on `provider_offers`
- `pick_candidates` must not have an active relationship to `picks` in Phase 2 beyond nullable placeholder `pick_id`

---

## 4. `market_universe` — Canonical Schema

### 4.1 Role

`market_universe` is the canonical Phase 2 board table.

It represents one current canonical market opportunity per provider-level natural key after materialization from raw provider offer data.

It is not:
- a historical archive
- a candidate table
- a picks table
- a final selection board

### 4.2 Columns

| Column | Type | Null | Notes |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `sport_key` | `text` | no | canonical sport |
| `league_key` | `text` | no | canonical league |
| `event_id` | `uuid` | yes | FK to canonical event if resolved |
| `participant_id` | `uuid` | yes | FK to canonical participant if resolved; null for game-line markets |
| `market_type_id` | `text` | no | canonical market type |
| `canonical_market_key` | `text` | no | canonical market identity used by downstream systems |
| `provider_key` | `text` | no | e.g. `sgo` |
| `provider_event_id` | `text` | no | provider event identifier |
| `provider_participant_id` | `text` | yes | null for game-line markets |
| `provider_market_key` | `text` | no | raw provider market key |
| `current_line` | `numeric` | yes | current line |
| `current_over_odds` | `integer` or `numeric` | yes | current over side |
| `current_under_odds` | `integer` or `numeric` | yes | current under side |
| `opening_line` | `numeric` | yes | opening line |
| `opening_over_odds` | `integer` or `numeric` | yes | opening over |
| `opening_under_odds` | `integer` or `numeric` | yes | opening under |
| `closing_line` | `numeric` | yes | closing line |
| `closing_over_odds` | `integer` or `numeric` | yes | closing over |
| `closing_under_odds` | `integer` or `numeric` | yes | closing under |
| `fair_over_prob` | `numeric` | yes | devigged fair over probability |
| `fair_under_prob` | `numeric` | yes | devigged fair under probability |
| `is_stale` | `boolean` | no | default false |
| `last_offer_snapshot_at` | `timestamptz` | no | latest source snapshot time used |
| `refreshed_at` | `timestamptz` | no | last materializer touch |
| `source_provenance` | `jsonb` | yes | provider/source trace fields only; no FK dependency |
| `created_at` | `timestamptz` | no | default now |
| `updated_at` | `timestamptz` | no | default now |

### 4.3 Natural key and uniqueness rule

The natural identity for a universe row is:

- `provider_key`
- `provider_event_id`
- `provider_participant_id`
- `provider_market_key`

However, `provider_participant_id` is nullable for game-line markets, so plain composite uniqueness is unsafe in Postgres.

**Locked rule:**  
Use a null-safe uniqueness strategy by coalescing nullable participant identity to a sentinel empty string at uniqueness time.

Canonical uniqueness semantics:

```sql
(provider_key, provider_event_id, COALESCE(provider_participant_id, ''), provider_market_key)
```

Rationale:
- game-line markets must not duplicate when participant is null
- the uniqueness rule must work for both player-prop and game-line markets
- Phase 2 should not split into dual uniqueness paths unless proven necessary

Implementation detail may use:
- an expression index, or
- a generated column plus unique index

but the semantics above are authoritative.

### 4.4 Opening / closing aggregation rule

Opening and closing values derive from `provider_offers`.

For a given universe natural key:

- **opening** values are taken from the earliest source row where `is_opening = true`
- **closing** values are taken from the earliest source row where `is_closing = true`

Ordering rule:
- order by source timestamp ascending
- earliest qualifying row wins

Once a universe row has opening or closing values set, refreshes must not replace them with later rows unless the contract is explicitly amended.

### 4.5 Current value rule

`current_line`, `current_over_odds`, and `current_under_odds` reflect the latest available source state for the universe natural key.

Ordering rule:
- latest source snapshot wins
- source ordering must be deterministic by timestamp

### 4.6 Fair probability rule

`fair_over_prob` and `fair_under_prob` are computed using existing devig logic when sufficient price structure exists.

Rules:
- if devig succeeds, materializer may write fair probabilities
- if devig cannot be computed, both may remain null
- null fair probabilities are valid in Phase 2
- failure to compute fair probabilities must not block universe row creation

### 4.7 Staleness rule

`is_stale` is a coarse freshness flag used by Phase 2 filtering.

**Locked Phase 2 definition:**

```text
is_stale = true when last_offer_snapshot_at < now() - interval '2 hours'
```

Rules:
- Phase 2 staleness threshold is fixed at 2 hours
- not env-configurable in Phase 2
- board scan may use this as a coarse rejection signal

### 4.8 Index requirements

Required indexes:

- unique natural key index using null-safe participant handling
- `(event_id)`
- `(participant_id, market_type_id)`
- `(is_stale, refreshed_at)`
- `(provider_key, provider_event_id)`
- any supporting timestamp index needed for materializer refresh efficiency

### 4.9 Provenance and retention

`market_universe` must not depend on `provider_offers` via live FK.

Rules:
- no FK from `market_universe` to `provider_offers`
- provenance may be stored in text/json form only
- `provider_offers` pruning must not break `market_universe`
- retention/pruning policy for `market_universe` is deferred beyond Phase 2 unless explicitly added in a separate issue

---

## 5. `pick_candidates` — Canonical Schema

### 5.1 Role

`pick_candidates` is the Phase 2 candidate evaluation table.

It stores coarse board-scan outcomes and candidate state, separate from both raw universe rows and canonical picks.

It is not:
- a final pick table
- a routing table
- a promotion table
- a historical scan archive in Phase 2

### 5.2 Columns

| Column | Type | Null | Notes |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `universe_id` | `uuid` | no | FK to `market_universe` |
| `status` | `text` | no | candidate lifecycle state |
| `rejection_reason` | `text` | yes | populated when rejected |
| `filter_details` | `jsonb` | yes | coarse filter trace |
| `model_score` | `numeric` | yes | Phase 3 only |
| `model_tier` | `text` | yes | Phase 3 only |
| `model_confidence` | `numeric` | yes | Phase 3 only |
| `shadow_mode` | `boolean` | no | default true |
| `pick_id` | `uuid` | yes | nullable placeholder; must remain null in Phase 2 |
| `scan_run_id` | `text` | yes | provenance only |
| `provenance` | `jsonb` | yes | scan metadata |
| `expires_at` | `timestamptz` | yes | expiry time if resolvable |
| `created_at` | `timestamptz` | no | default now |
| `updated_at` | `timestamptz` | no | default now |

### 5.3 Candidate lifecycle

Canonical lifecycle states:

- `pending`
- `qualified`
- `rejected`
- `converted`
- `expired`

Phase 2 allowed usage:
- `pending`
- `qualified`
- `rejected`

Phase 2 forbidden usage:
- `converted`
- any state transition that sets `pick_id`

`expired` may be defined in schema for forward compatibility, but if not actively used in Phase 2 it must remain inert until explicitly implemented.

### 5.4 Candidate cardinality and upsert rule

**Locked Phase 2 decision:**  
There is **one active candidate row per `universe_id`**.

This is the authoritative rule.

Implications:
- `scan_run_id` is provenance, not identity
- repeated scan passes update the same candidate row
- Phase 2 does not create a new candidate row per scan cycle
- Phase 2 does not use `pick_candidates` as a growing run-history table

Canonical uniqueness:

```sql
UNIQUE (universe_id)
```

Update semantics on repeated scan of same `universe_id`:
- update `status`
- update `rejection_reason`
- update `filter_details`
- update `scan_run_id`
- update `provenance`
- update `expires_at`
- update `updated_at`

Rationale:
- minimizes cardinality
- avoids immediate retention complexity
- simplifies Phase 3 reads
- preserves bounded Phase 2 scope

### 5.5 `filter_details` canonical shape

`filter_details` should be structured, stable, and machine-readable.

Canonical Phase 2 shape:

```json
{
  "missing_canonical_identity": false,
  "stale_price_data": false,
  "unsupported_market_family": false,
  "missing_participant_linkage": false,
  "invalid_odds_structure": false,
  "duplicate_suppressed": false,
  "freshness_window_failed": false
}
```

Additional keys may be added only if they are coarse filter facts and do not blur into Phase 3 model output.

### 5.6 `shadow_mode`

Rules:
- must default to `true`
- must remain `true` on all Phase 2 rows
- no Phase 2 code may set it to `false`

### 5.7 `pick_id`

Rules:
- nullable placeholder only
- must remain `NULL` for all Phase 2 rows
- any non-null `pick_id` in Phase 2 is a contract violation

### 5.8 `expires_at` ownership

`expires_at` is owned by board-scan write logic.

Rule:
- if `event_id` resolves to an event with a start time, set `expires_at = event.starts_at`
- if no event linkage exists, `expires_at` may remain null

Phase 2 does not require a cleanup daemon or retention policy for expired candidates beyond proof visibility unless separately scoped.

### 5.9 Index requirements

Required indexes:

- unique `(universe_id)`
- `(status)`
- partial index on `(pick_id)` where not null
- `(expires_at)`

---

## 6. Backward Compatibility

Rules:
- no backfill of existing `picks`
- no FK from existing `picks` to `pick_candidates`
- no mutation of submission, promotion, routing, settlement, or audit semantics
- no required change to scanner path
- no required rewrite of existing scanner-created picks

Existing picks are not candidates.  
Existing candidates do not exist pre-Phase 2.  
Phase 2 must not imply retroactive linkage.

---

## 7. Runtime Ownership

### 7.1 Materializer
Owns:
- reading `provider_offers`
- writing/upserting `market_universe`

Does not own:
- candidate generation
- pick creation
- model scoring
- routing or settlement

### 7.2 Board scan
Owns:
- reading `market_universe`
- writing/upserting `pick_candidates`

Does not own:
- pick creation
- model scoring
- routing
- promotion
- settlement

### 7.3 Scanner
Remains separate and unchanged in Phase 2.

---

## 8. Verification Requirements for Phase 2 Exit (UTV2-464)

Phase 2 cannot close until the evidence bundle proves all of the following:

1. `market_universe` exists and contains rows
2. `pick_candidates` exists and contains rows
3. repeated materializer runs are idempotent
4. repeated board scans do not create duplicate active candidates for the same `universe_id`
5. `pick_candidates.pick_id IS NULL` for all rows
6. `shadow_mode = true` for all rows
7. no candidate-layer code writes to `picks`
8. scanner path still functions independently of candidate layer
9. staleness behavior is observable and queryable
10. line movement output is proven if included in final Phase 2 implementation scope
11. feature gate proof exists if candidate generation is feature-gated

---

## 9. Implementation Notes for Follow-On Issues

### UTV2-459
Must implement `market_universe` exactly as governed here.

### UTV2-460
Must implement `pick_candidates` exactly as governed here.

### UTV2-461
Must implement idempotent universe materialization only.

### UTV2-462
Must not introduce schema drift without explicit contract-compatible extension.

### UTV2-463
Must write candidates only, never picks.

### UTV2-464
Must verify DB truth, not just runtime self-report.

---

## 10. Non-Negotiable Phase 2 Invariants

- candidate ≠ pick
- materializer ≠ selector
- board scan ≠ pick creator
- model fields remain null
- `pick_id` remains null
- scanner path remains parallel
- Phase 3 remains blocked until proof closes
