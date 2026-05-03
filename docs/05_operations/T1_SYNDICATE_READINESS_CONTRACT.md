# Syndicate Readiness Contract

**Status:** RATIFIED  
**Date:** 2026-04-30  
**Linear:** UTV2-801  
**Tier:** T1 — Readiness Gate Contract  
**Authority:** `SYNDICATE_PROOF_STANDARD.md` defines the quantitative thresholds. This contract defines the path to meeting them, what is currently blocking, and the proof procedure.  
**Prerequisite:** `T1_PRODUCTION_READINESS_CONTRACT.md` (UTV2-800) — production readiness must close before syndicate readiness can be attempted.

---

## 1. Purpose

Syndicate/elite readiness is a higher bar than production readiness. It requires the system to demonstrate superior information — measurable positive edge over market baselines, near-complete CLV coverage, Pinnacle-backed score provenance, and 90-day performance evidence from live picks.

This contract defines what the syndicate gate requires, why the current system cannot satisfy it, and what the path looks like once production readiness closes.

**Syndicate readiness is not a timeline claim.** It opens when the evidence passes all six dimensions at syndicate-tier thresholds — not before.

---

## 2. What Syndicate Readiness Means

Syndicate/elite readiness means the system can legitimately support claims of superior decision authority:

- Market-backed score provenance ≥ 60% (vs. production: 20%)
- Real-edge (Pinnacle-backed) provenance ≥ 40%
- 90-day performance evidence with measurable positive CLV
- Near-complete auto-grading (≥ 97%)
- 99.9% worker uptime over 30 days
- Sub-second API latency at scale
- Full operator decision support including CLV waterfall and performance dashboard

The domain math required for syndicate operation (Kelly, CLV, devig, edge, calibration) is already implemented in `packages/domain`. The remaining gap is data plumbing and automation — not new intellectual work.

---

## 3. Sequencing Constraint

```
Production readiness (UTV2-800) → MUST close first
                    ↓
Elite-core modeling (phases 1–6 of MODELING_SEQUENCE.md) → must materially pass
                    ↓
Syndicate gate (UTV2-801) → this contract
```

Attempting to measure syndicate thresholds before production readiness closes produces meaningless evidence (the pipeline is not stable enough to generate the 90-day data required).

---

## 4. Gate Conditions

All six dimensions must pass at syndicate-tier thresholds. One failing dimension blocks the gate.

### Dimension 1: Runtime Health (Syndicate Thresholds)

| Metric | Syndicate Threshold | Measurement Window |
|---|---|---|
| Worker uptime | ≥ 99.9% | 30-day rolling |
| API p99 latency (pick submission) | ≤ 1000 ms | 30-day rolling |
| Outbox delivery success rate | ≥ 99.9% of attempted deliveries | 30-day rolling |
| Pipeline end-to-end latency | ≤ 5 min for ≥ 95% of picks | 30-day rolling |
| Zero-downtime deployment | ≥ 1 verified zero-downtime deploy in window | Per-deploy |
| Error budget burn rate | < 50% of monthly error budget consumed | Rolling month |

**Gap from current:** Worker is DOWN as of 2026-04-30. Syndicate uptime (99.9%) requires 43.8 minutes maximum downtime per month. Current state is not measurable.

**Closing work items:**
- Worker stabilization (UTV2-572, UTV2-599, UTV2-602)
- Deployment telemetry contract (DEPLOYMENT_TELEMETRY_CONTRACT.md)
- Zero-downtime deploy procedure
- 30-day sustained uptime after worker stabilization

### Dimension 2: Score Provenance (Syndicate Thresholds)

| Metric | Syndicate Threshold | Current (2026-04-15) |
|---|---|---|
| Market-backed share | ≥ 60% | ~2.6% — **far from threshold** |
| Unknown share | ≤ 20% | ~97.4% — **far from threshold** |
| Picks with any edge attribution | ≥ 80% | ~2.6% |
| `real-edge` alone (Pinnacle-backed) | ≥ 40% | unknown |

**Gap from current:** The 60% market-backed threshold is approximately 23× the current rate. Reaching this requires:
1. Champion models registered for all active sport × market-family pairs
2. Scoring profiles explicitly wired per slice
3. Feature-completeness enforcement live
4. Adequate live data volume (the 30-day window needs to fill with market-backed picks)

**Closing work items:**
- Champion inventory standard complete (CHAMPION_INVENTORY_STANDARD.md, UTV2-622)
- Model-owned scoring profiles (UTV2-623)
- Feature-completeness gate live (UTV2-625)
- Score provenance coverage (UTV2-580)
- Challenger pipeline wiring (UTV2-624)

### Dimension 3: Settlement / CLV Coverage (Syndicate Thresholds)

| Metric | Syndicate Threshold | Measurement Window |
|---|---|---|
| Picks with automated settlement | ≥ 97% | 30-day rolling |
| Picks with resolved CLV at close | ≥ 85% | 30-day rolling |
| Picks with opening-line CLV (`clv_open`) | ≥ 70% | 30-day rolling |
| Manual grading backlog | ≤ 1% of picks ungraded > 24h after game end | 7-day rolling |
| Settlement error rate | ≤ 0.5% corrected | 30-day rolling |
| CLV computation uses `openFairOdds` for Pinnacle | Code reference + DB sample (signed) | Per proof bundle |

**CLV authority note:** Per `PROVIDER_KNOWLEDGE_BASE.md`, CLV must be derived from `openFairOdds` (not closing market odds), using Pinnacle lines where available. This must be explicitly proved in the evidence bundle — not assumed.

**CLV proof tables (post-UTV2-803):**
- **Closing-line CLV:** `pick_offer_snapshots WHERE snapshot_kind = 'closing_for_clv'` — immutable, pick-linked, written at settlement time
- **Opening-line CLV:** `provider_offer_history_compact WHERE is_opening = true AND provider_key = 'pinnacle'` — meaningful change deltas only, keyed by `identity_key`
- Pre-UTV2-803 `provider_offers` rows do not have immutable pick-linked snapshots and do not count toward syndicate CLV evidence

**Closing work items:**
- Expose CLV skip/failure visibility (UTV2-618)
- Auto-grading full coverage (UTV2-614, UTV2-615)
- Opening-line CLV (`clv_open`) populated at settlement time via `provider_offer_history_compact WHERE is_opening = true`
- Confirm `findClosingLine()` reads from `pick_offer_snapshots` (preferred) or `provider_offer_history_compact WHERE is_closing = true`, not raw `provider_offers`

### Dimension 4: Routing Trust (Syndicate Thresholds)

| Metric | Syndicate Threshold | Measurement Window |
|---|---|---|
| `trader-insights` or `exclusive-insights` picks with market-backed edge | ≥ 60% | 30-day rolling |
| `exclusive-insights` picks with `real-edge` (Pinnacle-backed) | ≥ 50% | 30-day rolling |
| Top-tier picks from `unsupported` champion slots without operator override | 0 | 30-day rolling |
| Routing decision replay fidelity | 100% replayable from stored `scoreInputs` | Per audit |
| Hard completeness gate for `trader-insights` | ≥ 0.75 | Per pick |
| Hard completeness gate for `exclusive-insights` | ≥ 0.85 | Per pick |

**Replayability requirement:** Any routing decision that cannot be replayed from its stored `scoreInputs` does not count toward routing trust data. See `REPLAYABLE_SCORING_CONTRACT.md`.

**Closing work items:** Depends on Dimensions 2 and 3 improving first. Then:
- Hard completeness gate in `packages/domain/src/promotion.ts` (UTV2-625)
- Routing decision audit export
- Replayability verification

### Dimension 5: Operator Decision Support (Syndicate Thresholds)

All production surfaces must pass (per UTV2-800), plus:

| Surface | Syndicate Requirement |
|---|---|
| Operator pick detail — CLV waterfall | Opening CLV, midgame CLV (if available), closing CLV |
| Performance dashboard | 30-day ROI by routing target, 30-day win rate, CLV+ rate |
| Score explanation | Which inputs drove the score (completeness, edge source, confidence delta) |
| Suppression audit trail | Suppression reason in full prose (not code enum value) |
| Champion model indicator | Whether pick was scored with champion-backed model or not |

**Closing work items:**
- CC analytics sequence (CC_ANALYTICS_SEQUENCE.md)
- Performance dashboard (CC_INTELLIGENCE_METRICS_REGISTER.md)
- CLV waterfall in pick detail

### Dimension 6: Performance Evidence (Syndicate Thresholds)

| Metric | Syndicate Threshold | Sample Requirement |
|---|---|---|
| Minimum settled pick sample | ≥ 500 with automated grading | 90-day window |
| Calibration gap (win rate vs implied probability) | ≤ 0.08 (Brier score ≤ 0.25) | 90-day window |
| CLV+ rate | ≥ 53% of settled picks | 90-day window |
| Average CLV% on `trader-insights` | ≥ 1.5% mean CLV at close | 90-day window, ≥ 200 picks |
| Average CLV% on `exclusive-insights` | ≥ 2.5% mean CLV at close | 90-day window, ≥ 100 picks |
| Flat-bet ROI on `trader-insights` | ≥ 0% (non-negative) | 90-day window, ≥ 200 picks |
| Flat-bet ROI on `exclusive-insights` | ≥ 2% | 90-day window, ≥ 100 picks |
| Out-of-sample calibration | ≥ 1 walk-forward eval in `experiment_ledger` | Per sport slot |

**90-day window requirement:** Syndicate evidence requires 90 continuous days of live-pipeline picks. This is the most time-bound constraint in the entire gate — it cannot be accelerated regardless of how quickly the other dimensions close. The 90-day clock starts after production readiness closes and the full scoring pipeline is operational.

**Simulation and backtested results do not satisfy this gate.** Evidence must be from picks scored, routed, and graded under the current live pipeline.

---

## 5. Current Gate Status Summary

| Dimension | Status | Primary Blocker |
|---|---|---|
| 1. Runtime Health | 🔴 BLOCKED | Worker DOWN; need 30-day clean window |
| 2. Score Provenance | 🔴 BLOCKED | ~2.6% (need ≥ 60%); champion models not populated |
| 3. Settlement / CLV | 🔴 BLOCKED | Depends on Dimension 2 volume + opening-line CLV gap |
| 4. Routing Trust | 🔴 BLOCKED | Depends on Dimensions 2 + 3 |
| 5. Operator Surfaces | 🟡 PARTIAL | CLV waterfall + performance dashboard not built |
| 6. Performance Evidence | 🔴 BLOCKED | Need 90-day window of live data after production readiness |

**Syndicate gate is not on the near-term horizon.** The minimum sequence is:
1. Production readiness closes (UTV2-800) — earliest estimate: several sprints after worker stabilization
2. 90-day live data collection window under stable pipeline
3. Score provenance reaches ≥ 60% (requires champion model coverage and live scoring volume)
4. Performance evidence compiled
5. T1 evidence bundle assembled and PM-approved

---

## 6. Proof Procedure

### 6.1 Who can declare syndicate readiness

Syndicate readiness requires a T1 evidence bundle, PM review, and GitHub label `t1-approved`. It cannot be self-certified.

### 6.2 Evidence bundle format

Same structure as production readiness but with `readiness_tier: "syndicate"` and an additional `basis_picks` and `basis_window_days` field per dimension. The 90-day window must be stated explicitly in the bundle.

### 6.3 Required evidence per dimension

1. **Runtime Health:** 30-day uptime telemetry, latency percentile reports, zero-downtime deploy record
2. **Score Provenance:** SQL query output from `pick_promotion_history` for 30-day window, with counts by edge source
3. **Settlement / CLV:**
   - SQL: `SELECT COUNT(*) FROM pick_offer_snapshots WHERE snapshot_kind = 'closing_for_clv'` vs total graded picks (30-day window)
   - SQL: opening-line CLV count from `provider_offer_history_compact WHERE is_opening = true AND provider_key = 'pinnacle'`
   - Auto-grading rate and settlement error rate from `settlement_records`
   - Code reference (file + line) confirming `findClosingLine()` uses `openFairOdds` from `pick_offer_snapshots` or `provider_offer_history_compact`
4. **Routing Trust:** Routing decision export with replayability sample; completeness gate test coverage
5. **Operator Surfaces:** Screen recordings or screenshots of CLV waterfall, performance dashboard, champion indicator
6. **Performance Evidence:** P/L report by routing target; calibration report with Brier score; walk-forward eval entry in `experiment_ledger`

---

## 7. What Does Not Constitute Syndicate Evidence

Per `SYNDICATE_PROOF_STANDARD.md §9`, the following phrases do not constitute evidence and must not appear in a syndicate proof bundle:

- "The system feels ready for elite use"
- "CLV is approximately tracked"
- "Operators seem satisfied"
- "Mostly passing syndicate thresholds"
- Any claim not tied to a specific query result, timestamp, and pick count

---

## 8. Relationship to Production Readiness

| Gate | UTV2 Issue | Status (2026-04-30) |
|---|---|---|
| Production readiness | UTV2-800 | BLOCKED — worker DOWN, score provenance gap |
| Syndicate readiness | UTV2-801 | NOT STARTED — awaiting production readiness |

The syndicate gate is intentionally separated from production readiness to prevent premature elite-tier claims. A system at production readiness is honest about its capabilities. A system claiming syndicate status must prove it with 90-day performance evidence and near-complete CLV coverage — not just a functioning pipeline.
