# Phase 2 Schema Contract — Market Universe and Pick Candidates

> **Status:** AUTHORITATIVE
> **Version:** 1.0
> **Authored:** 2026-04-09
> **Governs:** UTV2-459, UTV2-460, UTV2-461, UTV2-462, UTV2-463, UTV2-464
> **Supersedes:** nothing (new contract)
> **Authority tier:** T1 — all Phase 2 migrations and runtime must conform to this document

---

## 1. Purpose and Scope

This contract defines the exact data shape, boundary rules, and lifecycle semantics for the Phase 2 syndicate machine foundation layer: `market_universe` and `pick_candidates`.

Phase 2 is strictly a **universe + candidate foundation build**. It introduces two new tables, a materializer, a board scan framework, and a line movement tracker. It does not wire model scoring, produce final pick selection, introduce governance controls, or build feedback loops. Those belong to Phases 3–6 respectively and are explicitly out of scope here.

This document is the required pre-condition for all Phase 2 T1 migrations. No migration may deviate from this spec. If a conflict is found between this document and an implementation PR, this document governs unless a formal contract amendment is made and recorded here.

---

## 2. Architectural Boundaries (hard locks)

These rules are enforced for all of Phase 2. Violation of any rule is a T1 incident.

**2.1 Candidate layer does not write to `picks` in Phase 2.**
`pick_candidates.pick_id` must remain NULL on every row written in Phase 2. No Phase 2 code path may call `POST /api/submissions`, `repositories.picks.createPick`, or any equivalent. Conversion of candidates to picks is a Phase 4+ concern.

**2.2 Model score fields remain NULL in Phase 2.**
`pick_candidates.model_score`, `model_tier`, and `model_confidence` are defined as nullable placeholders. No Phase 2 service may populate them. Phase 3 wires the model runner against these columns.

**2.3 Materializer outputs `market_universe` rows only.**
The materializer (UTV2-461) reads `provider_offers` and writes/upserts `market_universe`. It does not generate candidates, does not create picks, and does not call any service outside the materializer boundary.

**2.4 Board scan outputs `pick_candidates` rows only.**
The board scan (UTV2-463) reads `market_universe` and writes `pick_candidates`. It does not create picks. It does not call `POST /api/submissions`. It does not touch `promotion_service`, `settlement_service`, or `distribution_service`.

**2.5 The system-pick-scanner direct-submission path is transitional and is not modified by Phase 2.**
`system-pick-scanner` (UTV2-455) reads `provider_offers` directly and writes `picks` directly. It bypasses both `market_universe` and `pick_candidates`. During the transitional period, Phase 2 does not route, modify, or replace this path. The direct-submission path will be retired by UTV2-495 (P7B-01) and UTV2-512 (P7B-02a), which migrate the scanner to the candidate layer.

**2.6 `shadow_mode` is always `true` in Phase 2.**
`pick_candidates.shadow_mode` defaults to `true` and must not be set to `false` by any Phase 2 code. Live candidate promotion requires Phase 4+ governance controls.

**2.7 Phase 3 is blocked until UTV2-464 closes.**
No Phase 3 model wiring begins until the Phase 2 evidence bundle (UTV2-464) is accepted by PM. This is a hard governance gate, not a soft recommendation.

---

## 3. Relationship Map

```
provider_offers (raw, append-only, 30-day pg_cron retention)
       │
       │  [materializer — UTV2-461]
       ▼
market_universe (canonical board layer — one row per market opportunity, upserted)
       │
       │  [board scan — UTV2-463]
       ▼
pick_candidates (evaluation layer — one active row per universe row, lifecycle-managed)
       │
       │  [Phase 4+ ONLY — forbidden in Phase 2]
       ▼
picks (canonical pick lifecycle entity)

system-pick-scanner ──────────────────────────────→ picks
  (transitional — reads provider_offers directly; retirement tracked in UTV2-495)
```

---

## 4. `market_universe` — Full Schema Spec

### 4.1 Column Definitions

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | uuid | NOT NULL | gen_random_uuid() | PK |
| `sport_key` | text | NOT NULL | — | e.g. `NBA`, `MLB` |
| `league_key` | text | NOT NULL | — | e.g. `NBA`, `MLB` |
| `event_id` | uuid | NULL | — | FK → events; resolved on materialization; null if event not yet ingested |
| `participant_id` | uuid | NULL | — | FK → participants; null for game-line markets |
| `market_type_id` | text | NULL | — | FK → market_types; null if canonical mapping not found |
| `canonical_market_key` | text | NOT NULL | — | matches `pick.market`; derived via `provider_market_aliases` |
| `provider_key` | text | NOT NULL | — | `sgo` or `odds-api` |
| `provider_event_id` | text | NOT NULL | — | raw provider event ID |
| `provider_participant_id` | text | NULL | — | raw provider participant ID; null for game-line markets |
| `provider_market_key` | text | NOT NULL | — | raw SGO key (e.g. `points-all-game-ou`) |
| `current_line` | numeric | NULL | — | current spread/total line |
| `current_over_odds` | numeric | NULL | — | American odds format |
| `current_under_odds` | numeric | NULL | — | American odds format |
| `opening_line` | numeric | NULL | — | from first `is_opening=true` offer; immutable once set |
| `opening_over_odds` | numeric | NULL | — | immutable once set |
| `opening_under_odds` | numeric | NULL | — | immutable once set |
| `closing_line` | numeric | NULL | — | from first `is_closing=true` offer; immutable once set |
| `closing_over_odds` | numeric | NULL | — | immutable once set |
| `closing_under_odds` | numeric | NULL | — | immutable once set |
| `fair_over_prob` | numeric | NULL | — | devigged via `@unit-talk/domain`; null if computation fails |
| `fair_under_prob` | numeric | NULL | — | devigged via `@unit-talk/domain`; null if computation fails |
| `is_stale` | boolean | NOT NULL | false | true when `last_offer_snapshot_at < now() - interval '2 hours'` |
| `last_offer_snapshot_at` | timestamptz | NOT NULL | — | timestamp of source provider_offers row |
| `refreshed_at` | timestamptz | NOT NULL | now() | updated on every materializer run |
| `created_at` | timestamptz | NOT NULL | now() | |
| `updated_at` | timestamptz | NOT NULL | now() | |

### 4.2 Natural Key and Upsert Key

**Decision:** coalesce `provider_participant_id` to `''` (empty string) in the unique index expression to handle NULL safely.

```sql
CREATE UNIQUE INDEX market_universe_natural_key
  ON market_universe (
    provider_key,
    provider_event_id,
    COALESCE(provider_participant_id, ''),
    provider_market_key
  );
```

Rationale: Postgres treats NULLs as non-equal in unique constraints, which would allow duplicate game-line rows when `provider_participant_id IS NULL`. The empty string sentinel is never a valid provider participant ID, making it a safe discriminator. A single index path covers both player-prop and game-line markets.

### 4.3 Opening/Closing Line Aggregation Rule

When multiple `provider_offers` rows exist for the same natural key with `is_opening=true` or `is_closing=true`, the materializer uses the **earliest by `created_at` ascending**.

Once an opening or closing line is set on a `market_universe` row, the materializer must **not overwrite it** on subsequent refresh runs. These fields are immutable after first population.

### 4.4 Staleness Definition

`is_stale` is computed at materializer run time:

```
is_stale = (last_offer_snapshot_at < now() - interval '2 hours')
```

The 2-hour threshold is hardcoded in Phase 2. It is not configurable via environment variable in Phase 2. Configurability is deferred to Phase 3.

### 4.5 Devig / Fair Probability

`fair_over_prob` and `fair_under_prob` are computed by the materializer using the existing devig logic in `@unit-talk/domain`. If the market structure is invalid (missing both sides, zero odds, etc.), both fields remain NULL. NULL is a valid state and is not a materializer failure.

### 4.6 Retention and Provider Offers FK

`market_universe` has **no FK to `provider_offers`**. The `provider_offers` table is pruned to 30 days via pg_cron (migration 016). A live FK would cause cascade failures on prune. Provenance is stored as text fields (`provider_key`, `provider_event_id`, `provider_market_key`) — these are stable identifiers, not live references.

`market_universe` rows are not pruned by the 30-day cron. Retention policy for `market_universe` is not defined in Phase 2 and is deferred.

### 4.7 Required Indexes

```sql
-- Natural key (upsert path)
CREATE UNIQUE INDEX market_universe_natural_key
  ON market_universe (provider_key, provider_event_id,
    COALESCE(provider_participant_id, ''), provider_market_key);

-- Board scan reads by event
CREATE INDEX market_universe_event_id ON market_universe (event_id)
  WHERE event_id IS NOT NULL;

-- Board scan reads by market type
CREATE INDEX market_universe_participant_market
  ON market_universe (participant_id, market_type_id)
  WHERE participant_id IS NOT NULL;

-- Staleness sweep
CREATE INDEX market_universe_stale_refresh
  ON market_universe (is_stale, refreshed_at);

-- Provider event batch reads
CREATE INDEX market_universe_provider_event
  ON market_universe (provider_key, provider_event_id);
```

---

## 5. `pick_candidates` — Full Schema Spec

### 5.1 Column Definitions

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | uuid | NOT NULL | gen_random_uuid() | PK |
| `universe_id` | uuid | NOT NULL | — | FK → market_universe |
| `status` | text | NOT NULL | `'pending'` | see lifecycle §5.2 |
| `rejection_reason` | text | NULL | — | populated on rejection; null otherwise |
| `filter_details` | jsonb | NULL | — | see §5.5 for canonical structure |
| `model_score` | numeric | NULL | — | **Phase 3 placeholder — must not be set in Phase 2** |
| `model_tier` | text | NULL | — | **Phase 3 placeholder — must not be set in Phase 2** |
| `model_confidence` | numeric | NULL | — | **Phase 3 placeholder — must not be set in Phase 2** |
| `shadow_mode` | boolean | NOT NULL | true | **must remain true in Phase 2** |
| `pick_id` | uuid | NULL | — | FK → picks; **must remain NULL in Phase 2**; Phase 4+ only |
| `scan_run_id` | text | NULL | — | provenance: ID of the scan cycle that last wrote this row |
| `provenance` | jsonb | NULL | — | scan version, filter set version, timestamp |
| `expires_at` | timestamptz | NULL | — | see §5.6 |
| `created_at` | timestamptz | NOT NULL | now() | |
| `updated_at` | timestamptz | NOT NULL | now() | |

### 5.2 Candidate Lifecycle States

```
pending   → qualified  (passed all coarse filters)
pending   → rejected   (failed one or more coarse filters; rejection_reason set)
qualified → converted  (Phase 4+ ONLY: pick created; pick_id set — FORBIDDEN in Phase 2)
qualified → expired    (event start time passed; opportunity window closed)
rejected  → [terminal]
expired   → [terminal]
```

**Phase 2 uses only:** `pending`, `qualified`, `rejected`.

The `converted` transition must not be coded or triggered in Phase 2. The `expired` state is defined for completeness and may be set by a Phase 2 cleanup pass, but is not required for Phase 2 proof.

### 5.3 Natural Key and Upsert Semantics

**Decision:** upsert on `universe_id` alone — one active candidate per universe row.

```sql
CREATE UNIQUE INDEX pick_candidates_universe_id
  ON pick_candidates (universe_id);
```

Rationale: one active candidate per market opportunity. Insert-per-scan-run would create unbounded table growth with no defined retention policy. `scan_run_id` is stored as a column for provenance audit but is NOT part of the unique constraint.

**Upsert behaviour on repeated scan run:**
- If a candidate for `universe_id` already exists: UPDATE `status`, `filter_details`, `scan_run_id`, `provenance`, `updated_at`. Do not insert a new row.
- This ensures idempotency across repeated scan cycles.

### 5.4 `pick_id` Constraint

`pick_id` is nullable. There is no NOT NULL constraint and no FK enforcement in Phase 2 code paths. Any Phase 2 code that sets `pick_id` is a scope violation and a T1 incident.

### 5.5 `filter_details` Jsonb Structure

Canonical shape (all fields required, boolean):

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

The board scan must write this structure on every candidate row, regardless of outcome. A candidate that passes all filters will have all values `false`. A rejected candidate will have at least one value `true`.

### 5.6 `expires_at` Ownership

`expires_at` is set by the board scan at candidate creation/upsert time:

- If `market_universe.event_id` is non-null and the linked `events.starts_at` is known: `expires_at = events.starts_at`
- If event linkage is not resolved (`event_id IS NULL`): `expires_at = NULL` — candidate does not auto-expire

Cleanup of expired candidates (status transition to `expired`) is handled by Phase 2 proof tooling (UTV2-464) or a future maintenance sweep. It is not required for Phase 2 proof to pass.

### 5.7 Required Indexes

```sql
-- Upsert path (one candidate per universe row)
CREATE UNIQUE INDEX pick_candidates_universe_id
  ON pick_candidates (universe_id);

-- Status reads for board scan and Phase 3 model runner
CREATE INDEX pick_candidates_status ON pick_candidates (status);

-- Expiry sweep
CREATE INDEX pick_candidates_expires ON pick_candidates (expires_at)
  WHERE expires_at IS NOT NULL;

-- Conversion audit (Phase 4+)
CREATE INDEX pick_candidates_pick_id ON pick_candidates (pick_id)
  WHERE pick_id IS NOT NULL;
```

---

## 6. How Existing Picks Relate to Candidates

No relationship exists in Phase 2.

- Existing `picks` rows have no `candidate_id` FK. None will be added in Phase 2.
- Picks written by `system-pick-scanner` are not candidates and are not tracked in `pick_candidates`. This is true during the transitional period while the direct-submission path remains active. Retirement is tracked in UTV2-495.
- Picks written by `smart-form`, `discord-bot`, or `api` sources are not candidates.
- `pick_candidates` does not back-fill, reference, or affect any existing `picks` rows.

---

## 7. Backward-Compatibility Notes

- All existing `picks`, `settlement_records`, `audit_log`, `pick_promotion_history` rows are unaffected.
- No existing API routes, services, or repositories are modified by Phase 2 migrations.
- No existing migrations are altered.
- **Migration ordering:** UTV2-459 (`market_universe`) applies first. UTV2-460 (`pick_candidates`) applies second. Both must use migration timestamps greater than `202604080016`. PRs must merge serially to preserve numbering.
- `pnpm supabase:types` must be regenerated after each migration is applied to Supabase.
- `SYNDICATE_MACHINE_ENABLED` environment variable gates the board scan (UTV2-463). When `false` (default), the board scan is a no-op. No other Phase 2 feature requires this gate.

---

## 8. Verification Requirements for Phase 2 Exit (UTV2-464)

The following must all be true for the Phase 2 evidence bundle to pass and Phase 3 to be unblocked:

| Check | Verification method |
|-------|-------------------|
| `market_universe` contains >0 rows | `SELECT count(*) FROM market_universe` |
| `pick_candidates` contains >0 rows | `SELECT count(*) FROM pick_candidates` |
| `pick_candidates.pick_id` is NULL on all rows | `SELECT count(*) FROM pick_candidates WHERE pick_id IS NOT NULL` must return 0 |
| `pick_candidates.model_score` is NULL on all rows | `SELECT count(*) FROM pick_candidates WHERE model_score IS NOT NULL` must return 0 |
| `pick_candidates.shadow_mode` is TRUE on all rows | `SELECT count(*) FROM pick_candidates WHERE shadow_mode = false` must return 0 |
| Materializer idempotency | Run materializer twice; row count does not increase on second run |
| Line movement records exist | `SELECT count(*) FROM market_universe WHERE …` or equivalent tracking query |
| Feature gate enforced | `SYNDICATE_MACHINE_ENABLED=false` → zero new rows written to `pick_candidates` on board scan run |
| No contamination of pick lifecycle | Zero new `picks` rows with `source` tracing back to board scan |

PM accepts evidence bundle → Phase 3 gate opens.
