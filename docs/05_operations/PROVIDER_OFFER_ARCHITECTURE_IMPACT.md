# Provider Offer Architecture Impact Summary

**Status:** Internal alignment document  
**Date:** 2026-04-30  
**Linear:** UTV2-803, UTV2-772  
**Audience:** PM, operators, engineering  

---

## 1. Why the Old Model Was Wrong

The original `provider_offers` table was an **unbounded append-only store**. Every ingest cycle (default: every 5 minutes) added new rows for every market from every provider. Nothing was ever updated — each refresh was a full new insert.

This meant:
- A single day of ingestion for 4 sports × ~800 markets × 2 providers = ~1.8 million rows
- The table grew without any automatic pruning
- As of the 2026-04-07 storage incident, `provider_offers` was the single largest table in the database and the primary driver of disk pressure
- The previous `provider_offer_current` was a **view** over this table — not a separate store — which meant every "current state" read scanned the full table before filtering to the latest row per identity

The root cause was a mismatch between use and storage: the system **only needed the current state** for scoring and a **sparse delta history** for CLV, but it was storing **full snapshots** at every polling interval forever.

---

## 2. What Changed

Three new structures were introduced in UTV2-772 and UTV2-803:

### 2a. `provider_offer_current` — Hot Current-State Table

`provider_offer_current` was promoted from a view to a **writer-maintained table**. It holds exactly one row per offer identity key (provider × event × market × participant × bookmaker).

- Ingestors **upsert** into this table on every cycle (update in place, no append)
- `market_universe` materializer reads from here for freshness
- Row count is bounded by the number of live markets — it does not grow with time
- Full RLS protection; anonymous access revoked

### 2b. `provider_offer_history_compact` — Meaningful Change Deltas

A new history table that records **only when something meaningful changed**:

| `change_reason` | When written |
|---|---|
| `first_seen` | First time an identity key appears |
| `line_change` | Spread/total line moved |
| `odds_change` | Odds changed without line move |
| `opening_capture` | Explicitly flagged as the opening line |
| `closing_capture` | Explicitly flagged as the closing line |
| `proof_capture` | Manual or replay-triggered snapshot |
| `replay_capture` | Replayability proof only |

This is the source for **opening-line CLV** (`is_opening = true, provider_key = 'pinnacle'`). It does not store every ingest cycle — only deltas.

### 2c. `pick_offer_snapshots` — Immutable Pick-Linked Proof

A new table storing an **immutable point-in-time snapshot of the offer state** at key moments in a pick's lifecycle:

| `snapshot_kind` | Captured at |
|---|---|
| `submission` | When the pick is submitted |
| `approval` | When the operator approves |
| `queue` | When the pick enters the delivery queue |
| `closing_for_clv` | At settlement time (closing odds for CLV computation) |
| `settlement_proof` | Full proof record at settlement |

This is the authoritative source for **closing-line CLV**. Because the snapshot is immutable and pick-linked, it cannot be retroactively altered and survives the pruning of `provider_offer_current` or history tables.

### 2d. `provider_offers` — Bounded Legacy Retention

The original `provider_offers` table is **not dropped** in this slice. It continues to receive writes during the dual-write transition. Retention is now bounded to **7 days** via `prune_provider_offers_bounded()` (batch-limited to prevent runaway deletes). The table is scheduled for deprecation after the cutover period is validated.

---

## 3. What Stays the Same

| Concern | Change? | Authority |
|---|---|---|
| `market_universe.is_stale` | No change | Materializer sets this; threshold is still 2h |
| `market_universe.last_offer_snapshot_at` | Source changed (reads from `provider_offer_current`), behavior unchanged | Materializer |
| Staleness gates in board-scan and candidate-scanner | No change | Read from `market_universe` only |
| CLV computation formula (`openFairOdds`) | No change | `PROVIDER_KNOWLEDGE_BASE.md` |
| Settlement pipeline interface | No change | Reads `settlement_records` |
| Scoring pipeline interface | No change | Reads `market_universe` |
| Promotion flow | No change | Staleness gate still at promotion time |
| `pick_promotion_history` | No change | Still written by the promotion service |
| Ingestor API contract | No change | Ingestor writes `ProviderOfferUpsertInput`; repository layer routes to correct tables |

The **public interface** of the system — what operators see, what the scoring pipeline reads, what the settlement service writes — is unchanged. The changes are entirely in the data layer beneath `market_universe`.

---

## 4. How CLV / Scoring / Settlement Are Preserved

### Scoring
Scoring reads from `market_universe`, which the materializer populates from `provider_offer_current`. The new hot table is **smaller and faster** than the old view, so scoring latency improves.

### CLV — Opening Line
Opening CLV uses `provider_offer_history_compact WHERE is_opening = true AND provider_key = 'pinnacle'`. This gives the Pinnacle `openFairOdds` at the moment the market opened — the same value that was previously read from `provider_offers WHERE is_opening = true`.

### CLV — Closing Line
Closing CLV uses `pick_offer_snapshots WHERE snapshot_kind = 'closing_for_clv'`. This snapshot is written by the settlement service when a game ends and the settlement process runs. It captures the Pinnacle `openFairOdds` at close.

Previously, the settlement service had to scan `provider_offers WHERE is_closing = true` — a query that became slower as the table grew and was not guaranteed to have an immutable row if the table was pruned. The new mechanism is immutable and pick-linked.

### Settlement
Settlement writes `settlement_records` as before. The only change is that `pick_offer_snapshots` rows are written alongside the settlement record to capture the closing-line proof. The settlement logic does not otherwise change.

---

## 5. Why This Improves Reliability

| Problem | Solution |
|---|---|
| Unbounded disk growth → storage incidents | `provider_offer_current` is bounded by live market count; `provider_offers` retention is 7 days |
| Full-table scans on "current state" queries | Hot table with single-row-per-identity, indexed on `snapshot_at` |
| CLV closing-line evidence could be pruned before settlement ran | `pick_offer_snapshots` is pick-linked and survives independently of offer table retention |
| Opening-line CLV required scanning entire `provider_offers` history | `provider_offer_history_compact.is_opening = true` is a sparse, indexed delta |
| No immutable audit trail per pick | `pick_offer_snapshots` provides a tamper-evident record of what the system saw at each lifecycle moment |
| Replay fidelity depended on unpruned `provider_offers` | Compact history + pick snapshots give deterministic replay without retaining every ingest |

---

## 6. Evidence Bundle Impact

Any T1 evidence bundle (production or syndicate readiness) must use the new tables for CLV proof:

- **CLV coverage:** Count from `pick_offer_snapshots WHERE snapshot_kind = 'closing_for_clv'`
- **Opening CLV:** Count from `provider_offer_history_compact WHERE is_opening = true AND provider_key = 'pinnacle'`
- **Legacy `provider_offers` data does not satisfy CLV evidence gates.** Pre-cutover rows lack immutable pick-linked snapshots.

See `T1_PRODUCTION_READINESS_CONTRACT.md §5.2` and `T1_SYNDICATE_READINESS_CONTRACT.md §6.3` for updated evidence bundle formats.

---

## 7. Risks and Open Items

| Risk | Severity | Status |
|---|---|---|
| Settlement service not yet wired to write `pick_offer_snapshots` at grading time | High | Must be wired before CLV coverage gate can be measured. Owned by Codex (UTV2-803 scope). |
| `provider_offers` dual-write period — both tables active, possible brief lag in `provider_offer_current` | Low | Materializer 2h threshold absorbs any transient lag. See `T2_STALE_DATA_BEHAVIOR_CONTRACT.md §2`. |
| `findClosingLine()` in `settlement-service.ts` may still read from `provider_offers` | Medium | Must be audited and updated to prefer `pick_offer_snapshots`. Owned by Codex. |
| `provider_offer_history_compact` `opening_capture` write path not yet instrumented in ingestor | Medium | Opening-line CLV requires this to be populated. Owned by Codex. |
| Supabase RLS on `pick_offer_snapshots` not yet verified for service-role access | Low | Standard service-role pattern applies; confirm before prod deploy. |

The items above are all in **Codex scope (UTV2-803)**. Claude Code is not touching ingestion, migration, or provider-offer storage in this work session.
