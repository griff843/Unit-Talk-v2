# Stale-Data Behavior Contract — Scanner & Scoring

**Status:** RATIFIED  
**Date:** 2026-04-30  
**Linear:** UTV2-775  
**Tier:** T2 — Implementation / Behavior Contract  
**Depends on:** `SYSTEM_PICK_CONTRACT.md`, `PROVIDER_KNOWLEDGE_BASE.md`, Phase 2 schema (`market_universe`, `pick_candidates`)  
**Does NOT overlap:** UTV2-803 (provider_offers retention), UTV2-772 (history partitions), any provider-offer migration

---

## 1. Purpose

Defines exactly what "stale data" means at each layer of the scanner and scoring pipeline, what each layer must do when it encounters stale data, and what metadata must be recorded. This contract is the authority for staleness-related behavior in:

- `apps/api/src/board-scan-service.ts`
- `apps/api/src/candidate-pick-scanner.ts`
- `apps/api/src/promotion-service.ts` (operator approval gate)
- `apps/api/src/settlement-service.ts` (CLV confidence)
- `apps/command-center/src/lib/data/research.ts` + adjacent pages

---

## 2. Architecture Context

Staleness in this system is always measured at **`market_universe`**, not at raw provider tables. The materializer (`market-universe-materializer.ts`) is the sole writer of `market_universe.is_stale` and `market_universe.last_offer_snapshot_at`. All scanner and scoring components read these fields — they do not re-read `provider_offers` or `provider_offer_current` directly for freshness.

**Source-agnosticism principle:** This contract is agnostic to whether the materializer reads from `provider_offers` (legacy) or `provider_offer_current` (post-UTV2-803). The staleness contract operates only on `market_universe` fields. Post-UTV2-803, the materializer reads from `provider_offer_current` (the hot writer-maintained table) instead of `provider_offers`. This does not change any behavior in this contract.

**Cutover edge case:** During the transition period when both `provider_offers` and `provider_offer_current` are active, the materializer reads from `provider_offer_current`. If `provider_offer_current` is momentarily behind `provider_offers` (e.g., during initial backfill), `market_universe.last_offer_snapshot_at` may lag by up to one ingest cycle (~5 minutes). This is an acceptable transient — the 2h global staleness threshold absorbs it without any contract change.

**Current materializer threshold:** `STALE_THRESHOLD_MS = 2h` (hardcoded in `market-universe-materializer.ts:26`). This contract does not change that value.

---

## 3. Existing Staleness Infrastructure (Baseline)

| Layer | File | Current behavior |
|---|---|---|
| Materializer | `market-universe-materializer.ts:26` | Sets `is_stale = true` when `last_offer_snapshot_at < now - 2h` |
| Board scan | `board-scan-service.ts:78` | Filter 2 `stale_price_data: row.is_stale === true` → candidate rejected |
| Board scan | `board-scan-service.ts:97` | Filter 7 `freshness_window_failed: false` — **always false, Phase 2 stub** |
| Candidate scanner | `candidate-pick-scanner.ts:52–55` | No staleness re-check at pick-creation time |
| CC health | `intelligence.ts:170–174` | Per-provider `active/stale/absent` using env var (display only) |

**Gaps closed by this contract:**
- `freshness_window_failed` is unimplemented (stub)
- No per-sport / proximity-tier threshold differentiation
- No staleness re-check in the candidate scanner
- No staleness gate at operator approval time
- No staleness metadata in candidate `provenance` or pick `metadata`
- No staleness indicator per row in the Command Center

---

## 4. Definitions

**Stale:** `market_universe.is_stale === true` — last provider snapshot older than 2h (global threshold, set by materializer).

**Freshness-window-failed:** Market that passes the global 2h threshold but violates a tighter proximity-based threshold derived from how close the event's start time is.

**Proximity tier:** Derived from the event's `starts_at` field via `market_universe.event_id → events.starts_at`. If `event_id` is null, proximity is **unknown** and proximity-based filtering does not apply.

**Stale at scan time:** `universe.is_stale === true` when the candidate-pick-scanner reads the universe row, regardless of what it was at board-scan time.

**Stale at promotion time:** `universe.is_stale === true` when an operator triggers pick promotion from `awaiting_approval`.

---

## 5. Staleness Threshold Decision Table

### 5A. Event Proximity Tiers (primary driver)

| Tier | Time to `event.starts_at` | Max snapshot age allowed | Filter that fires on violation |
|---|---|---|---|
| `pre` | > 24h | 6 hours | `stale_price_data` |
| `standard` | 6h – 24h | 2 hours | `stale_price_data` (already enforced globally) |
| `game-day` | 1h – 6h | 1 hour | `freshness_window_failed` |
| `pre-start` | < 1h | 20 minutes | `freshness_window_failed` |
| `unknown` | event FK is null | 2 hours (global fallback) | `stale_price_data` |

**Filter sequencing:** `stale_price_data` (Filter 2) is evaluated before `freshness_window_failed` (Filter 7). `freshness_window_failed` fires only when Filter 2 passed — i.e., the data is not globally stale but violates a proximity-tier threshold.

### 5B. Sport Modifiers (applied to tier threshold)

| Sport | Modifier |
|---|---|
| NBA, NHL, MLB, Soccer | × 1.0 |
| NFL | × 2.0 (slower-moving weekly lines) |
| Tennis | × 0.75 (faster-moving, shorter events) |
| Unknown / other | × 1.0 |

Modifier applies to the tier threshold. Example: NFL `game-day` tier → 1h × 2 = 2h max age allowed.

### 5C. Market Type Modifiers

| Market type prefix | Modifier |
|---|---|
| `player_*` (player props) | × 1.5 (slower-moving than game lines) |
| All other market types | × 1.0 |

Modifier stacks with sport modifier: effective threshold = tier_threshold × sport_mod × market_mod.

### 5D. Provider Treatment

No provider-specific threshold relaxation. Provider affects CLV interpretation (Odds API consensus is not valid for CLV closing-line proof per `PROVIDER_KNOWLEDGE_BASE.md`), not the freshness gate.

---

## 6. Board Scan Contract

### Filter 2 — `stale_price_data`

No change to existing logic. Fires when `universe.is_stale === true`. This is the global 2h guard.

### Filter 7 — `freshness_window_failed`

Currently always false. **Must be implemented.**

**Implementation contract:**

```
freshness_window_failed = true  when ALL of the following:
  1. market_universe.event_id is non-null (proximity can be computed)
  2. event.starts_at is available (event FK resolves)
  3. Proximity tier is 'game-day' or 'pre-start'
  4. now - last_offer_snapshot_at > (tier_threshold × sport_mod × market_mod)
  5. Filter 2 (stale_price_data) passed — not already globally stale
```

**Boundary condition: unknown proximity.** When `event_id` is null or the event row cannot be fetched, `freshness_window_failed` must return `false`. Fall to global `stale_price_data` check only.

**All threshold constants must live in a single exported constants object** in the board-scan-service — not scattered. Example:

```typescript
export const STALENESS_THRESHOLDS = {
  tiers: {
    pre: 6 * 60 * 60 * 1000,
    standard: 2 * 60 * 60 * 1000,
    game_day: 60 * 60 * 1000,
    pre_start: 20 * 60 * 1000,
  },
  sportModifiers: { nfl: 2.0, tennis: 0.75 },
  marketModifiers: { player_props: 1.5 },
} as const;
```

**Result when either filter fires:**

- `status: 'rejected'`
- `rejection_reason`: the first failing filter key
- Candidate is written to `pick_candidates` as rejected — it is NOT silently discarded

---

## 7. Candidate-Pick-Scanner Contract

Before calling `processSubmission` for any qualified candidate:

1. Re-read `market_universe.is_stale` for the candidate's universe row
2. If `is_stale === true` at scan time: **skip — do not submit**
3. Increment the `skipped` counter
4. Write staleness metadata to the candidate's `provenance` JSON (see §9)
5. Log with `reason: 'stale_at_scan_time'`

**No degraded confidence path.** Confidence is binary at scan time: fresh → submit, stale → skip. Degraded confidence scoring is deferred; no model exists for partial-staleness weighting.

---

## 8. Scoring Contract

| Question | Answer |
|---|---|
| Score allowed when stale? | No. Stale data is suppressed before scoring reaches any submission path. |
| Degraded score? | No. Not in this contract. Deferred. |
| Candidate suppressed? | Yes — via `status: 'rejected'` at board-scan or skip at candidate-scan. Suppression is always explicit. |
| Score reason recorded? | Yes — see §9 for required metadata fields. |
| CLV confidence when stale-origin? | `estimated` — not `confirmed`. See §8A. |

### 8A. Settlement CLV Confidence for Stale-Origin Picks

If `picks.metadata.data_freshness === 'stale'` (defensive case — should not be reachable after the gates above), settlement must record `settlement_records.confidence = 'estimated'` regardless of SGO finalization status.

This uses the existing `settlementConfidences` enum (`'confirmed' | 'estimated' | 'pending'`). No schema change required.

---

## 9. Required Audit and Metadata Fields

### 9A. `pick_candidates.filter_details` (no schema change)

`freshness_window_failed` is already declared in `PickCandidateFilterDetails`. Implement the logic — do not change the type.

### 9B. `pick_candidates.provenance` JSON additions

When a candidate is written (qualified or rejected), include:

```json
{
  "scan_run_id": "<uuid>",
  "snapshot_age_ms": 7200000,
  "event_starts_at": "2026-05-01T20:00:00Z",
  "minutes_to_event": 180,
  "proximity_tier": "game-day",
  "freshness_threshold_ms": 3600000,
  "stale_at_scan_time": false,
  "stale_reason": null
}
```

When the candidate-scanner skips a candidate at scan time, update the existing candidate row provenance:

```json
{
  "stale_at_scan_time": true,
  "stale_reason": "stale_at_scan_time",
  "stale_checked_at": "<ISO timestamp>"
}
```

### 9C. `picks.metadata` additions at submission

```json
{
  "snapshot_age_ms": 900000,
  "snapshot_at": "<ISO timestamp of last_offer_snapshot_at>",
  "proximity_tier": "game-day",
  "data_freshness": "fresh"
}
```

`data_freshness` is `'fresh'` or `'stale'`. Should always be `'fresh'` by the time a pick is created (gates above prevent stale submission), but recorded defensively.

**No new table columns required.** All fields fit in existing JSON columns.

---

## 10. Promotion Staleness Gate

When an operator approves a pick from `awaiting_approval` (triggers lifecycle transition):

1. Re-fetch `market_universe` for the pick's universe
2. If `universe.is_stale === true`: **block promotion**, return error code `STALE_DATA_AT_PROMOTION`
3. Write to `audit_log`: `entity_id = pick.id`, `entity_ref = pick.id`, event = `'promotion_blocked_stale_data'`
4. Command Center shows the block reason; **no operator override path for this error**

**Operator retry flow:** After a staleness block, the operator must wait for the next ingest cycle to complete (typically ≤ 5 minutes) and then retry the approval. The Command Center `DATA NOW STALE` warning should clear automatically once `market_universe.is_stale` returns to `false` on the next display refresh. The operator re-submits the approval — no special unlock action is needed.

**Rationale:** A pick can sit in `awaiting_approval` for hours while lines move. The operator approval moment is the last safe gate before Discord. A pick scored on stale data must wait for a fresh ingest cycle before it can be promoted.

---

## 11. Command Center Display Contract

### Research pages (lines, props)

- Render `STALE` badge (amber) when `market_universe.is_stale === true`
- Show `last_offer_snapshot_at` as relative time ("3h ago")
- When `freshness_window_failed` filter would fire (game-day or pre-start proximity + snapshot age violates tier threshold): render `PROXIMITY STALE` badge

### Awaiting Approval panel

- Show snapshot age at the time the pick was created (from `picks.metadata.snapshot_age_ms`)
- If `universe.is_stale === true` at display time: render `DATA NOW STALE` warning alongside the governance brake indicator
- Show `last_offer_snapshot_at` as relative time ("3h ago") so operator can estimate how long until fresh data arrives
- Operator sees the warning before approving; approval button remains visible but will return `STALE_DATA_AT_PROMOTION` if staleness persists at click time
- After a promotion block: display inline message "Data stale — retry after next ingest cycle (~5 min)"

### No new pages.

Staleness display integrates into existing research and awaiting-approval pages.

---

## 12. Fail-Closed Invariants

1. A candidate backed by stale data is never silently passed through. It is either `rejected` (board-scan) or `skipped` (candidate-scan) with an explicit reason recorded.
2. A pick that originated from stale data never reaches `awaiting_approval` via the automated path (gates above prevent it).
3. Suppression is always explicit: `rejection_reason` is non-null on every rejected candidate.
4. Operator approval of a pick backed by currently-stale universe data is blocked at the API layer, not just the UI.
5. `freshness_window_failed` never fires when `event_id` is null.

---

## 13. Proof Requirements Before Implementation

| Proof | Method |
|---|---|
| `market_universe.event_id` null rate | `SELECT COUNT(*) FILTER (WHERE event_id IS NULL) FROM market_universe` — determines how often proximity-tier logic fires vs. falls back |
| `events.starts_at` accessible via event FK | Confirm join works: `SELECT u.id, e.starts_at FROM market_universe u JOIN events e ON e.id = u.event_id LIMIT 10` |
| `pick_candidates.provenance` accepts new JSON keys | `SELECT provenance FROM pick_candidates LIMIT 1` — confirm no schema constraint on JSON shape |
| `promotion-service.ts` has a clear re-fetch point | Confirm where to insert the staleness gate before `transitionPickLifecycle` call |

Runtime proof requirement: after implementation, at least one candidate must be rejected with `freshness_window_failed = true` in a live game-day scenario (proximity tier `game-day` or `pre-start`) using real Supabase data.

---

## 14. Acceptance Criteria

| ID | Criterion | Verification |
|---|---|---|
| AC-1 | `freshness_window_failed` fires for `game-day` tier markets with snapshot > 1h old | Unit test: proximity 2h, snapshot 90min old → filter fires |
| AC-2 | `freshness_window_failed` does NOT fire for `pre` tier with snapshot < 6h old | Unit test |
| AC-3 | NFL sport modifier doubles threshold | Unit test: NFL game-day tier → 2h threshold |
| AC-4 | Candidate scanner skips stale universe at scan time | Unit test: `is_stale = true` → `skipped++`, no call to `processSubmission` |
| AC-5 | Candidate provenance updated with `stale_at_scan_time: true` on skip | Unit test: assert provenance fields on candidate row |
| AC-6 | `picks.metadata` includes `snapshot_age_ms`, `proximity_tier`, `data_freshness` | Integration test |
| AC-7 | Promotion blocked with `STALE_DATA_AT_PROMOTION` when universe is stale | Unit test: `is_stale = true` → promotion returns error |
| AC-8 | Promotion block written to `audit_log` | Unit test: assert `audit_log` contains `promotion_blocked_stale_data` event |
| AC-9 | `freshness_window_failed` never fires for markets with null `event_id` | Unit test: `event_id = null` → `freshness_window_failed = false` |
| AC-10 | CLV confidence is `estimated` for picks with `data_freshness: 'stale'` in metadata | Unit test |
| AC-11 | All staleness threshold constants are in a single exported object | Code review |
| AC-12 | Command Center research pages show STALE badge when `is_stale = true` | Manual verification |

---

## 15. No-Go Cases

| No-go | Reason |
|---|---|
| Degraded confidence scoring | No model exists for partial-staleness weighting. Deferred. |
| Provider-specific threshold relaxation | Provider affects CLV interpretation only, not freshness gate. |
| Shadow/proof-only scoring for stale candidates | Adds a code path with no consumer. |
| Operator staleness override | Operators should wait for fresh data, not override the gate. |
| Backfilling staleness metadata on existing picks | Out of scope. |
| Changes to `provider_offers`, `provider_offer_current`, `provider_offer_history_compact` | UTV2-803/772 scope. |
| Changes to `STALE_THRESHOLD_MS` in the materializer | Separate decision with schema implications. Not in scope. |
| New Command Center pages | Staleness display integrates into existing pages only. |
