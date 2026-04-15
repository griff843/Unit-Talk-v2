# Syndicate Proof Standard

**Status:** RATIFIED 2026-04-15
**Authority:** UTV2-591 — defines exact quantitative thresholds for production readiness and syndicate/elite readiness across all six proof dimensions.
**Depends on:** `SCORE_PROVENANCE_STANDARD.md` (UTV2-580 — market-backed share thresholds), `CHAMPION_INVENTORY_STANDARD.md` (UTV2-622 — model slot inventory and routing gates)

---

## Purpose

"Ready for production" and "ready for elite/syndicate claims" are two different bars. This document defines both, precisely, across six dimensions. Every threshold is measurable. Every gate is fail-closed.

The system currently sits at ~2.6% market-backed score provenance (22 of 841 picks in the 30-day window). That number alone blocks production readiness. This document makes all blocking conditions explicit so that readiness status is never a judgment call.

Failure mode this prevents: shipping a system that claims elite-tier decisioning authority but cannot demonstrate any of the quantitative properties that would justify that claim.

---

## Readiness Tiers

| Tier | Meaning |
|------|---------|
| **Production** | Minimum bar to ship to live operators. System is functioning as designed. No elite claims. |
| **Syndicate / Elite** | Higher bar required before marketing the system as elite or syndicate-grade. All six dimensions must pass. |

Both tiers are fail-closed. A single failing dimension blocks the tier. Partial credit does not exist.

---

## 1. Runtime Health

What the system must prove about worker liveness, API responsiveness, and pipeline delivery before any readiness tier can be claimed.

### Production readiness

| Metric | Threshold | Measurement window | Evidence required |
|--------|-----------|-------------------|-------------------|
| Worker uptime | ≥ 99.0% measured clock time | 7-day rolling | Deployment telemetry or process supervisor logs |
| API p99 latency (pick submission) | ≤ 2000 ms | 7-day rolling, ≥ 100 requests | API request logs |
| API p99 latency (operator pick detail) | ≤ 1500 ms | 7-day rolling, ≥ 100 requests | API request logs |
| Outbox delivery success rate | ≥ 99.0% of attempted deliveries | 7-day rolling | `DeliveryOutcome` records in Supabase |
| Outbox queue depth (stuck picks) | 0 picks stuck > 10 minutes | Snapshot at proof time | Supabase query against `outbox` table |
| Pipeline end-to-end latency (submit → grade) | ≤ 15 minutes for ≥ 95% of picks | 7-day rolling | `created_at` vs `graded_at` in `picks` table |
| Circuit breaker trips | 0 unresolved trips at proof time | Snapshot | Worker health endpoint or circuit breaker state store |

### Syndicate / elite readiness

All production thresholds must pass, plus:

| Metric | Threshold | Measurement window | Evidence required |
|--------|-----------|-------------------|-------------------|
| Worker uptime | ≥ 99.9% measured clock time | 30-day rolling | Deployment telemetry |
| API p99 latency (pick submission) | ≤ 1000 ms | 30-day rolling | API request logs |
| Outbox delivery success rate | ≥ 99.9% of attempted deliveries | 30-day rolling | `DeliveryOutcome` records |
| Pipeline end-to-end latency | ≤ 5 minutes for ≥ 95% of picks | 30-day rolling | `picks` table |
| Zero-downtime deployment | At least 1 verified zero-downtime deploy in window | Per-deploy | CI/CD deployment record |
| Error budget burn rate | < 50% of monthly error budget consumed | Rolling month | Telemetry or uptime provider |

---

## 2. Score Provenance Quality

References: `SCORE_PROVENANCE_STANDARD.md` (UTV2-580). The thresholds in that document are authoritative. This section restates them as proof gate requirements and adds the current baseline.

### Current state (2026-04-15)

| Metric | Current | Production threshold | Syndicate threshold | Status |
|--------|---------|---------------------|--------------------|----|
| Market-backed share (30-day) | ~2.6% (22/841) | ≥ 20% | ≥ 60% | **FAIL (both tiers)** |
| Unknown share (30-day) | ~97.4% (819/841) | ≤ 60% | ≤ 20% | **FAIL (both tiers)** |
| Picks with any edge attribution | ~2.6% | ≥ 40% | ≥ 80% | **FAIL (both tiers)** |

### Production readiness

| Metric | Threshold | Measurement window |
|--------|-----------|-------------------|
| Market-backed share (`real-edge` + `consensus-edge`) | ≥ 20% | 30-day rolling |
| Unknown share | ≤ 60% | 30-day rolling |
| Picks with any edge attribution (non-unknown) | ≥ 40% | 30-day rolling |
| `score_provenance` section in evidence bundle | Present with `threshold_pass: true` | Per proof bundle |

### Syndicate / elite readiness

| Metric | Threshold | Measurement window |
|--------|-----------|-------------------|
| Market-backed share (`real-edge` + `consensus-edge`) | ≥ 60% | 30-day rolling |
| Unknown share | ≤ 20% | 30-day rolling |
| Picks with any edge attribution | ≥ 80% | 30-day rolling |
| `real-edge` alone (Pinnacle-backed) | ≥ 40% | 30-day rolling |
| `score_provenance` section in evidence bundle | Present with `threshold_pass: true` | Per proof bundle |

Evidence bundle format for score provenance is defined in `SCORE_PROVENANCE_STANDARD.md` section 4.

---

## 3. Settlement / CLV Coverage

What percentage of picks must have resolved CLV and automated grading. A system where operators cannot measure the actual closing line value of their picks cannot support any calibration or profitability claims.

### Production readiness

| Metric | Threshold | Measurement window | Evidence required |
|--------|-----------|-------------------|-------------------|
| Picks with automated settlement (pass/fail/push) | ≥ 85% of graded picks | 30-day rolling | `picks.status IN ('won','lost','push')` with `graded_by = 'automated'` |
| Picks with resolved CLV at close | ≥ 60% of settled picks | 30-day rolling | `pick_promotion_history.metadata.clv` non-null |
| Manual grading backlog | ≤ 5% of picks ungraded > 48 hrs after game end | 7-day rolling | `picks` table query |
| Settlement error rate | ≤ 2% of automated settlements subsequently corrected | 30-day rolling | Correction events in `audit_log` or equivalent |

### Syndicate / elite readiness

| Metric | Threshold | Measurement window | Evidence required |
|--------|-----------|-------------------|-------------------|
| Picks with automated settlement | ≥ 97% of graded picks | 30-day rolling | Same query |
| Picks with resolved CLV at close | ≥ 85% of settled picks | 30-day rolling | `pick_promotion_history.metadata.clv` |
| Picks with opening-line CLV (clv_open) | ≥ 70% of settled picks | 30-day rolling | `pick_promotion_history.metadata.clv_open` |
| Manual grading backlog | ≤ 1% of picks ungraded > 24 hrs after game end | 7-day rolling | `picks` table |
| Settlement error rate | ≤ 0.5% corrected | 30-day rolling | `audit_log` |
| CLV distribution audit | Signed proof that CLV computation uses `openFairOdds` for Pinnacle | Per proof bundle | Code reference + DB sample |

CLV computation authority: per `PROVIDER_KNOWLEDGE_BASE.md`, CLV must be derived from `openFairOdds` (not closing market odds), using Pinnacle lines where available. A CLV metric that uses a non-Pinnacle baseline does not satisfy the syndicate threshold.

---

## 4. Routing Trust

What fraction of top-tier routing decisions (`trader-insights`, `exclusive-insights`) must be backed by real edge. Routing to elite channels without real edge creates a false signal for operators.

### Production readiness

| Metric | Threshold | Measurement window | Evidence required |
|--------|-----------|-------------------|-------------------|
| `trader-insights` or `exclusive-insights` picks with market-backed edge | ≥ 30% | 30-day rolling | `pick_promotion_history` where `promotionTarget IN ('trader-insights','exclusive-insights')` cross-referenced with edge source |
| Top-tier picks sourced from slots with no champion model | Must have explicit edge OR operator-submitted `promotionScores.edge` override | Per pick | Routing audit log |
| Picks suppressed at suppression gate (not silently routed down) | 100% — suppression must be explicit, never silent | Per pick | `suppressionReason` non-null on all suppressed picks |

### Syndicate / elite readiness

| Metric | Threshold | Measurement window | Evidence required |
|--------|-----------|-------------------|-------------------|
| `trader-insights` or `exclusive-insights` picks with market-backed edge | ≥ 60% | 30-day rolling | Same query |
| `exclusive-insights` picks with `real-edge` (Pinnacle-backed) | ≥ 50% | 30-day rolling | Edge source filter on `exclusive-insights` subset |
| Picks routed to top-tier from `unsupported` champion slots without explicit operator override | 0 | 30-day rolling | Zero-violation audit |
| Routing decision replay fidelity | 100% of routing decisions must be replayable from stored `scoreInputs` | Per audit | `REPLAYABLE_SCORING_CONTRACT.md` compliance check |
| Hard completeness gate live and enforced | ≥ 0.75 completeness for `trader-insights`, ≥ 0.85 for `exclusive-insights` | Per pick | Gate enforcement in `packages/domain/src/promotion.ts` confirmed by test coverage |

A routing decision that cannot be replayed from its stored `scoreInputs` does not count as a valid routing trust data point. See `REPLAYABLE_SCORING_CONTRACT.md`.

---

## 5. Operator Decision Support

What operator surfaces must be live — not placeholders, not stub UIs — before readiness can be claimed. This dimension is about completeness of the operator experience, not just the scoring pipeline.

### Production readiness

| Surface | Requirement | Verification method |
|---------|------------|---------------------|
| Pick detail page | Must display: edge source label, trust level, score breakdown, settlement status, CLV value (when available) | Manual spot-check of ≥ 10 picks across status types |
| Picks list / queue | Must display: score, routing target, status, edge source indicator | Smoke test against live operator session |
| Review queue | Must display: suppressed picks with `suppressionReason` rendered (not null/blank) | Spot-check ≥ 5 suppressed picks |
| Held picks queue | Must exist and show picks in `held` status | Existence + at least 1 pick visible |
| Score provenance indicator | Each pick must show edge source in human-readable label (not raw enum value) | Automated render test or spot-check |
| Settlement display | Settled picks must show outcome (won/lost/push) and CLV when resolved | Spot-check ≥ 10 settled picks |

**No placeholder UI permitted.** A surface that renders "—", "N/A", or a blank where data should be present is not live. It must be wired to real data or the surface fails this gate.

### Syndicate / elite readiness

All production surfaces must pass, plus:

| Surface | Requirement | Verification method |
|---------|------------|---------------------|
| Operator pick detail — CLV waterfall | Must show opening CLV, midgame CLV (if available), closing CLV | Spot-check ≥ 10 picks with full CLV data |
| Performance dashboard | Must show: 30-day ROI by routing target, 30-day win rate, CLV+ rate | Live at time of proof bundle |
| Score explanation | Each pick detail must show which inputs drove the score (completeness score, edge source, confidence delta) | Spot-check ≥ 10 picks |
| Suppression audit trail | Each suppressed pick must show the suppression reason in full prose (not code) | Spot-check ≥ 10 suppressed picks |
| Champion model indicator | Each pick detail must indicate whether it was scored with a champion-backed model or not | Spot-check ≥ 10 picks across slices |

---

## 6. Performance Evidence

What calibration, ROI, and CLV evidence must exist before readiness tier claims are valid. Evidence must cover real settled picks — not synthetic data, not simulated results.

### Production readiness

| Metric | Threshold | Sample requirement | Evidence required |
|--------|-----------|-------------------|-------------------|
| Minimum settled pick sample | ≥ 100 picks settled with automated grading | 30-day window | `picks` table count |
| Win rate vs implied probability (calibration gap) | Calibration gap ≤ 0.15 | 30-day window, ≥ 100 picks | Calibration report |
| CLV+ rate (positive CLV at close) | ≥ 48% of settled picks (above coin-flip baseline) | 30-day window | CLV data in `pick_promotion_history` |
| No provably negative-edge routing | Zero picks in `trader-insights` or `exclusive-insights` with `edge < 0` and `edgeSource != 'unknown'` | 30-day window | Query on `pick_promotion_history` |
| ROI claim basis | Any stated ROI figure must reference an exact date range, pick count, and routing target | Per claim | Proof bundle |

### Syndicate / elite readiness

| Metric | Threshold | Sample requirement | Evidence required |
|--------|-----------|-------------------|-------------------|
| Minimum settled pick sample | ≥ 500 picks settled with automated grading | 90-day window | `picks` table count |
| Win rate vs implied probability (calibration gap) | Calibration gap ≤ 0.08 | 90-day window | Calibration report (Brier score ≤ 0.25) |
| CLV+ rate | ≥ 53% of settled picks | 90-day window | CLV data |
| Average CLV% on `trader-insights` picks | ≥ 1.5% mean CLV at close | 90-day window | CLV distribution report |
| Average CLV% on `exclusive-insights` picks | ≥ 2.5% mean CLV at close | 90-day window | CLV distribution report |
| Flat-bet ROI on `trader-insights` | ≥ 0% (non-negative) | 90-day window, ≥ 200 picks | P/L report |
| Flat-bet ROI on `exclusive-insights` | ≥ 2% | 90-day window, ≥ 100 picks | P/L report |
| Out-of-sample calibration | At least 1 walk-forward evaluation run logged to `experiment_ledger` with `run_type = 'eval'` | Per sport slot | `experiment_ledger` query |

**Simulation or backtested results do not satisfy the production or syndicate evidence thresholds.** Evidence must be from live-submitted picks that were scored, routed, and graded under the current pipeline. The proof must state the date range, the pipeline version, and the pick count explicitly.

---

## 7. Readiness Gate Summary

### Production readiness gate

ALL six dimensions must pass. The gate is fail-closed: one failing dimension blocks production readiness regardless of the scores on other dimensions.

| Dimension | Gate condition | Current status (2026-04-15) |
|-----------|---------------|----------------------------|
| 1. Runtime health | Worker ≥ 99.0%, outbox ≥ 99.0%, queue depth 0 stuck | Unknown — no uptime telemetry in evidence bundle |
| 2. Score provenance | Market-backed ≥ 20%, unknown ≤ 60% | **FAIL** — ~2.6% market-backed |
| 3. Settlement / CLV coverage | ≥ 85% auto-graded, CLV on ≥ 60% of settled | Unknown — no CLV coverage report |
| 4. Routing trust | ≥ 30% top-tier picks market-backed | **FAIL** — provenance too low to satisfy |
| 5. Operator decision support | All surfaces live, no placeholders | Partially live — full audit required |
| 6. Performance evidence | ≥ 100 settled picks, calibration gap ≤ 0.15 | Unknown — sample size not confirmed |

**Production readiness is blocked at minimum by dimension 2 (score provenance) and dimension 4 (routing trust), until market-backed share reaches ≥ 20%.**

### Syndicate / elite readiness gate

Production readiness must pass first. Then all six syndicate thresholds must pass.

| Dimension | Syndicate gate condition |
|-----------|------------------------|
| 1. Runtime health | Worker ≥ 99.9%, outbox ≥ 99.9%, p99 latency ≤ 1000 ms |
| 2. Score provenance | Market-backed ≥ 60%, unknown ≤ 20%, real-edge ≥ 40% |
| 3. Settlement / CLV coverage | ≥ 97% auto-graded, CLV ≥ 85%, opening-line CLV ≥ 70% |
| 4. Routing trust | ≥ 60% top-tier market-backed, hard completeness gate enforced, full replay fidelity |
| 5. Operator decision support | Full surfaces including CLV waterfall, performance dashboard, champion indicator |
| 6. Performance evidence | ≥ 500 settled, Brier ≤ 0.25, CLV+ ≥ 53%, ROI evidence by tier |

---

## 8. Evidence Bundle Requirements

### Production readiness proof (T1)

The T1 evidence bundle for a production readiness claim MUST include:

```json
{
  "readiness_tier": "production",
  "proof_date": "<ISO-8601>",
  "pipeline_version": "<git-sha>",
  "dimensions": {
    "runtime_health": {
      "worker_uptime_7d_pct": <float>,
      "outbox_success_rate_7d_pct": <float>,
      "stuck_pick_count": <int>,
      "circuit_breaker_trips_open": <int>,
      "threshold_pass": <boolean>
    },
    "score_provenance": {
      "window_days": 30,
      "total_picks": <int>,
      "market_backed_pct": <float>,
      "unknown_pct": <float>,
      "threshold_pass": <boolean>
    },
    "settlement_clv": {
      "auto_graded_pct": <float>,
      "clv_coverage_pct": <float>,
      "manual_backlog_pct": <float>,
      "threshold_pass": <boolean>
    },
    "routing_trust": {
      "top_tier_market_backed_pct": <float>,
      "suppression_explicit_pct": <float>,
      "threshold_pass": <boolean>
    },
    "operator_surfaces": {
      "surfaces_audited": ["pick_detail", "picks_list", "review_queue", "held_queue"],
      "placeholder_violations": <int>,
      "threshold_pass": <boolean>
    },
    "performance_evidence": {
      "settled_pick_count": <int>,
      "calibration_gap": <float>,
      "clv_positive_rate": <float>,
      "threshold_pass": <boolean>
    }
  },
  "overall_pass": <boolean>
}
```

`overall_pass: true` requires all six `threshold_pass` values to be `true`. An evidence bundle with any `threshold_pass: false` does not satisfy the production readiness proof gate.

### Syndicate / elite readiness proof (T1)

Same structure as production, with syndicate-level thresholds and an additional `basis_picks` and `basis_window_days` field per dimension. The `readiness_tier` field must be `"syndicate"`.

---

## 9. What This Standard Does Not Permit

The following phrases do not constitute evidence and cannot appear in a proof bundle as a substitute for measurable data:

- "The UI looks polished"
- "Feels ready for production"
- "Mostly working"
- "CLV is approximately tracked"
- "Good enough for initial launch"
- "Operators seem satisfied"

Every claim in a readiness proof must be traceable to a query result, a telemetry export, a test run output, or a code-path audit with a specific file reference and timestamp.

---

## 10. Why These Two Tiers Are Separated

Production readiness means the system is functioning correctly, delivering picks reliably, grading them automatically, and showing operators real data rather than placeholders. It does not require elite-level precision.

Syndicate/elite readiness means the system can support claims of superior information — that the picks it surfaces have measurable, positive edge over market baselines, that CLV is real and verified, and that the routing tier structure actually tracks quality rather than just configuration.

The gap between the two is not cosmetic. A system at production readiness is honest about its capabilities. A system claiming elite status must prove it with 90-day performance evidence, near-complete CLV coverage, and a market-backed score provenance rate that makes the score trustworthy as a decision authority.

Conflating the two tiers inflates the program. This standard prevents that.
