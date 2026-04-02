# T1 Canonical Operator Review Queue Contract

**Status:** RATIFIED — 2026-04-02
**Issue:** UTV2-273
**Authority:** T1 contract. Owned by PM (A Griffin).
**Lane:** Claude (design). Codex (future implementation).
**Cross-references:** `T1_CANONICAL_MIGRATION_AND_COMPATIBILITY_CONTRACT.md` (UTV2-269), `T1_REFERENCE_DATA_SEEDING_AND_RECONCILIATION_POLICY.md` (UTV2-270), `T1_COMMAND_CENTER_BURNIN_TRUTH_CONTRACT.md` (UTV2-263)

---

## 1. Queue Purpose

### What enters the review queue

Items that the automated reconciliation system cannot resolve with high confidence. Specifically:

- Provider entities that don't match any canonical entity
- Provider entities that match multiple canonical entities (ambiguous)
- Provider labels that conflict with existing canonical truth
- New provider books or market keys not yet in the canonical registry

### Why queueing is required

The seeding/reconciliation policy (UTV2-270) establishes that:

1. **Teams must never be auto-created from provider labels.** An unrecognized team name from SGO is not evidence that a new franchise exists.
2. **Players must never be auto-merged.** Two canonical players that appear to be the same person require operator judgment.
3. **Market types must never be auto-created from provider keys.** A new provider market key might be a variant of an existing canonical type, not a new type.

Silent auto-resolution in these cases would create ghost entities, accidental merges, and canonical drift. The queue is the pressure valve that lets the system continue operating while unresolved items wait for human judgment.

### Relation to canonical backbone

The review queue sits between the ingestor (which creates unresolved alias rows) and the canonical registry (which requires resolved, high-confidence mappings). Items in the queue do not block pick submission or grading — they represent data-quality improvements that accumulate over time.

---

## 2. Queue Item Types

| Type | Code | Trigger | Example |
|------|------|---------|---------|
| **Unresolved team alias** | `unresolved-team` | Ingestor encounters team name not matching any `teams` row | SGO sends "LA Clippers" but canonical team is `nba:clippers` with `short_name: 'Clippers'` |
| **Unresolved player alias** | `unresolved-player` | Ingestor creates a player but fuzzy match was ambiguous or failed; alias has `confidence: 'unresolved'` | SGO sends "J. Smith" — matches 3 canonical players |
| **Ambiguous player match** | `ambiguous-player` | Fuzzy match found 2+ candidate canonical players | Provider "M. Williams" matches both Marcus Williams and Mikal Williams |
| **Conflicting provider identity** | `conflict-identity` | Two providers map the same entity to different canonical targets | SGO says player X is on Team A; Odds API says Team B (and both have existing aliases) |
| **Unresolved player-team assignment** | `unresolved-assignment` | Player appears in event but no team context available | Player in SGO feed with null `teamId` |
| **Provider book alias missing** | `missing-book` | `provider_offers` contains a `provider_key` not in `provider_book_aliases` | New book `odds-api:bet365` not in alias table |
| **Provider market alias missing** | `missing-market` | Provider sends market key not in `provider_market_aliases` | SGO sends `"three-pointers-all-game-ou"` — no canonical mapping exists |

---

## 3. Required Queue Item Payload

### Common fields (all item types)

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `id` | uuid | Yes | Queue item primary key |
| `item_type` | text | Yes | One of the type codes from §2 |
| `status` | text | Yes | Queue lifecycle state (§6) |
| `provider` | text | Yes | Source provider (`sgo`, `odds-api`, `manual`) |
| `provider_key` | text | Yes | Provider's identifier for the entity |
| `provider_display_name` | text | Yes | Provider's human-readable label |
| `sport_id` | text | Nullable | Sport context |
| `league_id` | text | Nullable | League context |
| `event_id` | text | Nullable | Event context (when available) |
| `event_name` | text | Nullable | Event display name for operator context |
| `confidence_reason` | text | Yes | Why auto-resolution failed (`no-match`, `multi-match`, `conflict`, `missing-mapping`) |
| `candidate_ids` | text[] | Nullable | Array of potential canonical IDs (for ambiguous matches) |
| `candidate_names` | text[] | Nullable | Array of potential canonical display names |
| `resolved_canonical_id` | text | Nullable | Set when operator resolves |
| `resolved_by` | text | Nullable | Operator identity |
| `resolved_at` | timestamptz | Nullable | Resolution timestamp |
| `resolution_action` | text | Nullable | Action taken (§4 codes) |
| `resolution_notes` | text | Nullable | Operator freeform notes |
| `created_at` | timestamptz | Yes | When item entered queue |
| `updated_at` | timestamptz | Yes | Last modification |
| `source_alias_id` | uuid | Nullable | FK to `provider_entity_aliases.id` or `provider_market_aliases.id` |

### Type-specific payload (in `metadata` jsonb)

| Item type | Additional metadata |
|-----------|-------------------|
| `unresolved-team` | `{ team_name_variants: string[], league_context: string }` |
| `unresolved-player` | `{ player_name: string, team_hint: string, position_hint: string }` |
| `ambiguous-player` | `{ candidate_details: [{ id, name, team, sport }] }` |
| `conflict-identity` | `{ provider_a: { provider, canonical_id }, provider_b: { provider, canonical_id } }` |
| `unresolved-assignment` | `{ player_id: string, event_teams: string[], observed_at: string }` |
| `missing-book` | `{ provider_book_key: string, provider_key: string }` |
| `missing-market` | `{ provider_market_key: string, sport_id: string, sample_offer_id: string }` |

---

## 4. Operator Decisions

### Allowed actions

| Action code | Applies to | Effect | Reversible |
|-------------|-----------|--------|------------|
| `attach-existing` | All alias types | Link the provider alias to an existing canonical entity | Yes — alias can be re-pointed |
| `create-canonical` | `unresolved-player`, `missing-book`, `missing-market` | Create a new canonical entity + alias | Soft-reversible — deactivate canonical entity |
| `merge-request` | `ambiguous-player`, `conflict-identity` | Flag for player merge (does not auto-merge — creates a merge task) | N/A — merge is a separate workflow |
| `defer` | All | Move to `awaiting-context` status; revisit later | Yes — can be re-opened |
| `mark-invalid` | All | Provider data is garbage; discard the alias | Yes — can be re-opened |
| `escalate` | All | Item requires contract or schema decision beyond operator scope | Yes — can be de-escalated |

### Actions NOT allowed from the queue

| Prohibited action | Why | Alternative |
|-------------------|-----|-------------|
| Auto-merge two canonical players | UTV2-269 red line: merges require deliberate operator action | Use `merge-request` to create a separate merge task |
| Create a new canonical team | Teams require governed seed data (UTV2-270) | `escalate` with note: "need new team in canonical registry" |
| Create a new market type | Market types require thoughtful canonical key design | `escalate` with note: "new market type needed" |
| Delete a canonical entity | Canonical keys are immutable (UTV2-269) | Soft-deactivate (`active = false`) |

### Decision flow

```
Queue item arrives (status: new)
       ↓
Operator opens item in Command Center
       ↓
Sees: provider label, sport/league context, candidate matches, event context
       ↓
Chooses action:
  ├── attach-existing → selects canonical entity → alias updated → status: resolved
  ├── create-canonical → enters canonical details → entity + alias created → status: resolved
  ├── merge-request → selects entities to merge → merge task created → status: resolved
  ├── defer → status: awaiting-context
  ├── mark-invalid → status: invalid
  └── escalate → status: escalated
```

---

## 5. Audit and Provenance Rules

### What must be recorded for every operator action

| Field | Required | Purpose |
|-------|----------|---------|
| `resolution_action` | Yes | Action code from §4 |
| `resolved_by` | Yes | Operator identity (e.g., `griff843`) |
| `resolved_at` | Yes | Timestamp |
| `resolution_notes` | Recommended | Freeform explanation, especially for `escalate` and `merge-request` |
| `resolved_canonical_id` | Yes (for `attach-existing`, `create-canonical`) | The canonical entity that was linked or created |

### How decisions affect future reconciliation

| Action | Future effect |
|--------|--------------|
| `attach-existing` | Updates `provider_entity_aliases` with `confidence: 'manual'`. Future ingest cycles with the same provider key auto-resolve via the alias table. |
| `create-canonical` | New canonical entity + alias created. Future ingest cycles auto-resolve. |
| `mark-invalid` | Alias row updated with `confidence: 'invalid'`. Future ingest cycles that produce the same provider key will not re-queue (alias exists but has no canonical target). |
| `defer` | No change to alias table. Item stays in queue. May be auto-resolved if a future ingest cycle provides better context. |
| `escalate` | No change to alias table. Requires PM or architecture decision before resolution. |

### Reversibility

| Action | How to reverse |
|--------|---------------|
| `attach-existing` | Re-open queue item, re-point alias to a different canonical entity |
| `create-canonical` | Soft-deactivate the canonical entity (`active = false`). Re-open queue item. |
| `mark-invalid` | Re-open queue item. Change alias confidence from `'invalid'` to `'unresolved'`. |
| `merge-request` | Cancel the merge task before execution. If already merged, merges are not reversible (operator must split manually — rare edge case). |

---

## 6. Queue Lifecycle

### Statuses

| Status | Meaning | Transitions to |
|--------|---------|---------------|
| `new` | Just entered queue from ingestor or reconciliation | `resolved`, `awaiting-context`, `invalid`, `escalated` |
| `awaiting-context` | Operator deferred; needs more data | `new` (re-opened), `resolved`, `invalid`, `escalated` |
| `resolved` | Operator took a resolution action | Terminal (may be re-opened to `new` if resolution was wrong) |
| `invalid` | Provider data was garbage; no action needed | Terminal (may be re-opened to `new`) |
| `escalated` | Requires contract/schema decision beyond operator scope | `resolved`, `new` (de-escalated) |

### Lifecycle diagram

```
                 ┌─────────┐
    ingestor ───>│   new    │
                 └────┬─────┘
                      │
          ┌───────────┼───────────┬─────────────┐
          ▼           ▼           ▼             ▼
    ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐
    │ resolved │ │awaiting- │ │ invalid │ │escalated │
    │          │ │ context  │ │         │ │          │
    └──────────┘ └────┬─────┘ └─────────┘ └────┬─────┘
                      │                         │
                      └──── re-open ────────────┘
                              ↓
                         ┌─────────┐
                         │   new   │
                         └─────────┘
```

### Auto-resolution

If a queue item is in `new` or `awaiting-context` status and a subsequent ingest cycle provides a clear match (e.g., the canonical entity was created by a different path), the reconciliation system may auto-resolve the queue item with:
- `resolution_action: 'auto-resolved'`
- `resolved_by: 'system'`
- `resolution_notes: 'Canonical entity created by {source}; alias auto-linked'`

This is the only form of auto-resolution allowed. It does not create entities, merge players, or make ambiguous decisions.

---

## 7. UX / Surface Implications

### Minimum Command Center surface

#### 7a. Queue list view (`/review-queue/aliases` or similar)

| Column | Source |
|--------|--------|
| Item type | `item_type` with display label |
| Status | Color-coded badge |
| Provider | `provider` |
| Provider label | `provider_display_name` |
| Sport | `sport_id` → `sports.display_name` |
| Candidates | Count + first candidate name |
| Age | `created_at` → "X hours ago" |
| Actions | Resolve / Defer / Invalid / Escalate buttons |

**Filters:** By status (`new` default), by item type, by sport, by provider.

**Sort:** Newest first (default), or oldest first for triage.

#### 7b. Queue item detail view

| Section | Content |
|---------|---------|
| **Header** | Item type, provider, provider label, status badge, age |
| **Context** | Sport, league, event (if available), provider key |
| **Candidates** | List of candidate canonical entities with display name, ID, and match score |
| **Resolution form** | Action selector + canonical entity picker (for `attach-existing`) + notes field + submit |
| **History** | Previous resolution attempts if re-opened |

#### 7c. Queue summary on Dashboard

Add to the existing Command Center dashboard:

| Metric | Display |
|--------|---------|
| Unresolved alias queue depth | Count badge (yellow if >10, red if >50) |
| Oldest unresolved item age | "X days" (warn if >7 days) |
| Items resolved today | Count |
| Items escalated | Count (red if >0) |

### Not required for MVP

- Bulk resolution (resolve multiple items at once)
- Auto-suggest canonical matches (P2 enhancement)
- Provider alias health dashboard (P3)
- Queue item notifications / alerts

---

## 8. Explicit Recommendations

### What Codex should build first

| Priority | Component | Notes |
|----------|-----------|-------|
| **P0** | `canonical_review_queue` table (or reuse alias tables with `confidence` filtering) | Schema for queue items. Can be a dedicated table or a view over `provider_entity_aliases` WHERE `confidence IN ('unresolved', 'ambiguous')` |
| **P0** | Ingestor writes unresolved aliases on reconciliation failure | Currently ingestor uses `namesMatch()` heuristic; should additionally INSERT into alias table with `confidence: 'unresolved'` when no match found |
| **P1** | Command Center queue list view | Read-only surface showing unresolved items with filter/sort |
| **P1** | Command Center queue detail + resolution form | Operator resolves items via UI |
| **P2** | Dashboard queue summary widget | Count badge + oldest item age |

### Implementation decision: dedicated table vs alias-table view

**Recommended: View over alias tables.**

The `provider_entity_aliases` and `provider_market_aliases` tables already have `confidence` fields that capture unresolved state. Rather than creating a separate queue table (which would duplicate data and require sync), the review queue should be a filtered view:

```sql
-- Unresolved entity aliases needing review
CREATE VIEW canonical_review_queue AS
SELECT
  id,
  'entity' AS queue_domain,
  provider,
  entity_kind AS item_type,
  provider_entity_key AS provider_key,
  provider_display_name,
  CASE
    WHEN team_id IS NOT NULL THEN 'resolved'
    WHEN player_id IS NOT NULL THEN 'resolved'
    WHEN participant_id IS NOT NULL THEN 'resolved'
    ELSE 'unresolved'
  END AS status,
  metadata,
  created_at,
  updated_at
FROM provider_entity_aliases
WHERE team_id IS NULL AND player_id IS NULL AND participant_id IS NULL

UNION ALL

SELECT
  id,
  'market' AS queue_domain,
  provider,
  'market' AS item_type,
  provider_market_key AS provider_key,
  provider_display_name,
  CASE WHEN market_type_id IS NOT NULL THEN 'resolved' ELSE 'unresolved' END AS status,
  metadata,
  created_at,
  updated_at
FROM provider_market_aliases
WHERE market_type_id IS NULL

UNION ALL

SELECT
  id,
  'book' AS queue_domain,
  provider,
  'book' AS item_type,
  provider_book_key AS provider_key,
  provider_display_name,
  CASE WHEN sportsbook_id IS NOT NULL THEN 'resolved' ELSE 'unresolved' END AS status,
  metadata,
  created_at,
  updated_at
FROM provider_book_aliases
WHERE sportsbook_id IS NULL;
```

Resolving an item = updating the alias row to set the canonical FK. No separate queue table needed.

**Add columns to alias tables if not present:**
- `resolution_notes` (text, nullable) — operator notes
- `resolved_by` (text, nullable) — operator identity
- `resolved_at` (timestamptz, nullable) — resolution timestamp

### What may remain manual for now

| Task | Why manual |
|------|-----------|
| Merge two canonical players | Requires identity judgment; no automated merge path |
| Create new canonical teams | Teams are governed seed data |
| Create new market types | Requires canonical key design |
| Bulk triage of historical unresolved items | Initial bootstrap may produce many; batch triage by operator |

### What must never be auto-resolved without new contract approval

1. **Player merges** — Two canonical players identified as the same person (UTV2-269 red line)
2. **Team creation** — New team from provider label alone (UTV2-270 rule)
3. **Market type creation** — New market type from provider key alone (UTV2-270 rule)
4. **Sportsbook creation** — New book from provider key alone
5. **Canonical key changes** — Any modification to an existing canonical key (immutable per UTV2-269)

---

## Authority and Update Rule

This document is T1. Queue item types, operator action codes, and audit rules may not be changed without PM approval. UI layout and non-functional enhancements are T3.
