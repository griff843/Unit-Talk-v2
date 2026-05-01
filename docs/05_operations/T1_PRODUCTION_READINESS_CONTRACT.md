# Production Readiness Contract

**Status:** RATIFIED  
**Date:** 2026-04-30  
**Linear:** UTV2-800  
**Tier:** T1 — Readiness Gate Contract  
**Authority:** Supersedes the stale `production_readiness_checklist.md` for gate-closure purposes. That file is preserved as historical template only.  
**Depends on:** `SYNDICATE_PROOF_STANDARD.md` (threshold authority), `EXECUTION_MAP.md` (phase sequencing), `PRODUCTION_READINESS_CANARY_PLAN.md` (canary mechanics)

---

## 1. Purpose

This contract defines the exact conditions under which production readiness can be declared, the current blocking state of each condition, the work items that close each blocker, and the verification procedure.

**Production readiness is a binary gate.** It is not a score, a percentage complete, or a judgment call. All conditions in §3 must pass before the gate is open.

---

## 2. What Production Readiness Means

Production readiness means:

- The system is functioning as designed under real load
- Picks are being submitted, scored, routed, delivered, and graded correctly
- Operators have real, non-placeholder data on every surface they need to make decisions
- No elite-tier claims are made — those require the separate syndicate gate (UTV2-801)

Production readiness does **not** require:
- 99.9% uptime (that is syndicate-tier)
- CLV coverage ≥ 85% (syndicate-tier)
- Performance evidence over 90 days (syndicate-tier)
- ≥ 3 odds providers (syndicate-tier)

---

## 3. Gate Conditions

All six dimensions are fail-closed. One failing dimension blocks the gate regardless of the others.

### Dimension 1: Runtime Health

| Metric | Production Threshold | Measurement Window |
|---|---|---|
| Worker uptime | ≥ 99.0% | 7-day rolling |
| API p99 latency (pick submission) | ≤ 2000 ms | 7-day rolling, ≥ 100 requests |
| API p99 latency (operator pick detail) | ≤ 1500 ms | 7-day rolling, ≥ 100 requests |
| Outbox delivery success rate | ≥ 99.0% of attempted deliveries | 7-day rolling |
| Outbox queue depth (stuck picks) | 0 picks stuck > 10 minutes | Snapshot at proof time |
| Pipeline end-to-end latency (submit → grade) | ≤ 15 min for ≥ 95% of picks | 7-day rolling |
| Circuit breaker trips | 0 unresolved trips at proof time | Snapshot |

**Current status:** BLOCKED. Worker is DOWN as of 2026-04-30 (`ops:brief` reports no runs or heartbeats in health window). This is a critical single-point failure.

**Closing work items:**
- UTV2-572: Worker runtime recovery
- UTV2-599: API supervision
- UTV2-602: Durable hosting + CI deploy
- Sustained 7-day clean health window after worker stabilization

### Dimension 2: Score Provenance Quality

Thresholds from `SYNDICATE_PROOF_STANDARD.md` §2.

| Metric | Production Threshold | Current (2026-04-15) |
|---|---|---|
| Market-backed share (`real-edge` + `consensus-edge`) | ≥ 20% | ~2.6% — **FAIL** |
| Unknown share | ≤ 60% | ~97.4% — **FAIL** |
| Picks with any edge attribution | ≥ 40% | ~2.6% — **FAIL** |

**Current status:** BLOCKED. This is the most severe gap. The system currently produces ~2.6% market-backed picks out of ~841 in the 30-day window. Reaching 20% requires the full candidate/scoring pipeline (board-scan → model scoring → submission) to be operating on live, market-backed data with champion models registered for active sport/market-family pairs.

**Closing work items:**
- Champion model inventory populated for active sport × market-family pairs (CHAMPION_INVENTORY_STANDARD.md)
- Scoring profiles wired per slice (UTV2-623)
- Feature-completeness enforcement live (UTV2-625)
- Score provenance coverage verified (UTV2-580)
- `SYNDICATE_MACHINE_ENABLED=true` in production with stale-data gates live (UTV2-775)

### Dimension 3: Settlement / CLV Coverage

| Metric | Production Threshold | Measurement Window |
|---|---|---|
| Picks with automated settlement | ≥ 85% of graded picks | 30-day rolling |
| Picks with resolved CLV at close | ≥ 60% of settled picks | 30-day rolling |
| Manual grading backlog | ≤ 5% of picks ungraded > 48h after game end | 7-day rolling |
| Settlement error rate | ≤ 2% of automated settlements subsequently corrected | 30-day rolling |

**CLV proof mechanism (post-UTV2-803):** CLV resolution evidence must use `pick_offer_snapshots WHERE snapshot_kind = 'closing_for_clv'` joined to `settlement_records`. Pre-UTV2-803 rows in `provider_offers` do not have immutable pick-linked snapshots and do not satisfy this gate.

**Current status:** UNKNOWN. No CLV coverage report exists for the current window. MLB readiness gate (UTV2-433) requires fresh post-fix MLB settlements. CLV wiring confirmed live (PR #486) but coverage rate not measured. `pick_offer_snapshots` table exists as of UTV2-803 but requires pipeline wiring to populate `closing_for_clv` snapshots at settlement time.

**Closing work items:**
- UTV2-433: MLB production-readiness — fresh post-fix MLB settlements with `clvBackedOutcomeCount >= 10`
- Wire settlement-service to write `pick_offer_snapshots` row with `snapshot_kind = 'closing_for_clv'` at grading time
- Generate CLV coverage report: `SELECT COUNT(*) FROM pick_offer_snapshots WHERE snapshot_kind = 'closing_for_clv'` vs total graded picks
- Verify auto-grading linkage is live (UTV2-614)

### Dimension 4: Routing Trust

| Metric | Production Threshold |
|---|---|
| `trader-insights` or `exclusive-insights` picks with market-backed edge | ≥ 30% |
| Picks suppressed at suppression gate — suppression always explicit | 100% |

**Current status:** BLOCKED (depends on Dimension 2 — provenance too low to satisfy routing trust threshold).

**Closing work items:** Dimension 2 closes first. Routing trust follows.

### Dimension 5: Operator Decision Support

| Surface | Requirement |
|---|---|
| Pick detail page | Edge source label, trust level, score breakdown, settlement status, CLV value (when available) |
| Picks list / queue | Score, routing target, status, edge source indicator — no placeholders |
| Review queue | Suppressed picks with `suppressionReason` rendered (non-null, non-blank) |
| Held picks queue | Exists and shows picks in `held` status |
| Settlement display | Outcome (won/lost/push) and CLV when resolved |

**No placeholder UI permitted.** A cell rendering "—", "N/A", or blank where real data should be is a failing violation.

**Current status:** Partially live. Full audit required. Command Center pages exist (PR #486+) but per-surface audit has not been formalized.

**Closing work items:**
- UTV2-793: Production health dashboard
- Formal operator surface audit: spot-check ≥ 10 picks per status type, document violations
- UTV2-775 (stale-data display in research pages)

### Dimension 6: Performance Evidence

| Metric | Production Threshold | Sample Requirement |
|---|---|---|
| Minimum settled pick sample | ≥ 100 picks with automated grading | 30-day window |
| Win rate vs implied probability (calibration gap) | ≤ 0.15 | ≥ 100 settled picks |
| CLV+ rate | ≥ 48% of settled picks | 30-day window |
| No provably-negative routing | 0 picks in top-tier with `edge < 0` and `edgeSource != 'unknown'` | 30-day window |

**Current status:** UNKNOWN. Sample size not confirmed. Simulation or backtested results do not satisfy this gate — evidence must be from live picks scored and graded under the current pipeline.

**Closing work items:**
- Collect 30-day live settlement sample after worker is stable
- Generate calibration report from `settlement_records`
- Verify CLV+ rate from `pick_promotion_history.metadata.clv`

---

## 4. Current Gate Status Summary

| Dimension | Status | Primary Blocker |
|---|---|---|
| 1. Runtime Health | 🔴 BLOCKED | Worker DOWN |
| 2. Score Provenance | 🔴 BLOCKED | ~2.6% market-backed (need ≥ 20%) |
| 3. Settlement / CLV | 🟡 UNKNOWN | No CLV coverage report; MLB gate open |
| 4. Routing Trust | 🔴 BLOCKED | Depends on Dimension 2 |
| 5. Operator Surfaces | 🟡 PARTIAL | Formal audit incomplete |
| 6. Performance Evidence | 🟡 UNKNOWN | Sample size not confirmed |

**Minimum path to production readiness:**

```
1. Fix worker DOWN (UTV2-572)
2. Stabilize runtime — 7-day clean health window
3. Enable scoring pipeline with champion models (UTV2-622, UTV2-623, UTV2-625)
4. Run 30 days with SYNDICATE_MACHINE_ENABLED=true + stale-data gates live (UTV2-775)
5. Verify score provenance ≥ 20% market-backed
6. Generate CLV coverage report; close UTV2-433
7. Complete operator surface audit
8. Collect performance evidence (100+ settled picks)
9. Assemble T1 evidence bundle and submit for PM review
```

---

## 5. Verification Procedure

### 5.1 Who can declare production readiness

Production readiness requires a T1 evidence bundle reviewed and approved by PM (GitHub label `t1-approved`). It cannot be self-certified by Claude or Codex.

### 5.2 Evidence bundle format

The evidence bundle must follow `EVIDENCE_BUNDLE_TEMPLATE.md` and include a `readiness_tier: "production"` JSON block per `SYNDICATE_PROOF_STANDARD.md §8`:

```json
{
  "readiness_tier": "production",
  "proof_date": "<ISO-8601>",
  "pipeline_version": "<git-sha>",
  "dimensions": {
    "runtime_health": { "worker_uptime_7d_pct": <float>, "outbox_success_rate_7d_pct": <float>, "stuck_pick_count": 0, "circuit_breaker_trips_open": 0, "threshold_pass": true },
    "score_provenance": { "window_days": 30, "total_picks": <int>, "market_backed_pct": <float>, "unknown_pct": <float>, "threshold_pass": true },
    "settlement_clv": {
      "auto_graded_pct": <float>,
      "clv_coverage_pct": <float>,
      "clv_proof_table": "pick_offer_snapshots",
      "clv_snapshot_kind": "closing_for_clv",
      "manual_backlog_pct": <float>,
      "threshold_pass": true
    },
    "routing_trust": { "top_tier_market_backed_pct": <float>, "suppression_explicit_pct": 100.0, "threshold_pass": true },
    "operator_surfaces": { "surfaces_audited": ["pick_detail", "picks_list", "review_queue", "held_queue", "settlement"], "placeholder_violations": 0, "threshold_pass": true },
    "performance_evidence": { "settled_pick_count": <int>, "calibration_gap": <float>, "clv_positive_rate": <float>, "threshold_pass": true }
  },
  "overall_pass": true
}
```

`overall_pass: true` requires all six `threshold_pass` values to be `true`.

### 5.3 Verification steps before submitting evidence bundle

1. Run `pnpm verify` — must pass
2. Run `pnpm test:db` — must pass against live Supabase
3. Query runtime health metrics for 7-day window
4. Query score provenance distribution for 30-day window
5. Query CLV coverage rate: `SELECT COUNT(*) FROM pick_offer_snapshots WHERE snapshot_kind = 'closing_for_clv'` vs graded picks in 30-day window
6. Manually spot-check ≥ 10 picks per status type across all operator surfaces
7. Confirm `suppressionReason` non-null on all suppressed picks
8. Confirm 0 stuck outbox rows

---

## 6. What Blocks Production Readiness (Prohibited Shortcuts)

- **Runtime health cannot be proved from `pnpm verify` alone.** Static checks are necessary but not sufficient. Worker uptime, outbox delivery, and pipeline latency must be measured from live runtime data.
- **Simulation or backtested results do not count** for performance evidence. Live picks only.
- **Historical backfill does not satisfy CLV coverage.** Only post-fix settlements from the current provenance path count (UTV2-433 precedent).
- **Pre-UTV2-803 `provider_offers` rows do not satisfy CLV coverage.** CLV proof requires `pick_offer_snapshots` rows with `snapshot_kind = 'closing_for_clv'`. Rows that pre-date the cutover lack immutable pick-linked offer snapshots and cannot be used as closing-line CLV evidence.
- **A stale checklist is not evidence.** The `production_readiness_checklist.md` file is deprecated for gate-closure purposes.
- **Agent narrative is not evidence.** Every claim in the evidence bundle must be traceable to a query result, telemetry export, or test run output.

---

## 7. Relationship to Syndicate Gate

Production readiness closes this gate (UTV2-800). Syndicate/elite readiness is a separate gate (UTV2-801) with higher thresholds across all six dimensions. Syndicate gate cannot open until production gate is closed.

The sprint distance from current state to production readiness is not fixed — it depends on how quickly score provenance improves once the champion model inventory and scoring pipeline are fully operational.
