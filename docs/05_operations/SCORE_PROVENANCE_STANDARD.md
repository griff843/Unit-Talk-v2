# Score Provenance Standard

**Status:** RATIFIED 2026-04-15
**Authority:** UTV2-580 — defines score provenance as a first-class readiness metric, sets minimum market-backed share thresholds, and specifies enforcement points.
**Depends on:** `packages/contracts/src/promotion.ts` (edgeSources enum), `apps/api/src/clv-service.ts`

---

## Purpose

The current score is not trustworthy enough for operator-heavy decisioning. The audit finding was stark:

- 30-day sample: 841 picks inspected
- 22 had devigging/Kelly/real-edge data
- Edge-source distribution: 22 `sgo-edge`, **819 `unknown`**, 0 `real-edge`, 0 `consensus-edge`

A score where 97.4% of picks have `unknown` edge-source is a hint, not a decision authority. This document defines what "trustworthy" means, makes it measurable, and makes readiness fail loudly when the threshold is not met.

---

## 1. Edge Source Taxonomy

The authoritative enum is in `packages/contracts/src/promotion.ts`:

| Edge Source | Meaning | Trust Level |
|-------------|---------|-------------|
| `real-edge` | Model probability vs Pinnacle devigged line | **High** — authoritative market-backed |
| `consensus-edge` | Model probability vs multi-book devigged consensus | **High** — authoritative market-backed |
| `sgo-edge` | Model probability vs SGO devigged line | **Medium** — single-book backed |
| `confidence-delta` | Confidence minus implied probability from submitted odds | **Low** — no external market reference |
| `explicit` | Edge provided directly via `pick.metadata.promotionScores.edge` | **Medium** — operator-asserted |
| `unknown` | No edge source identified | **None** — score is a hint only |

For readiness purposes: `real-edge` and `consensus-edge` are **market-backed**. All others are not.

---

## 2. Provenance Coverage Metric

**Market-backed share** = (picks with `real-edge` or `consensus-edge`) / (total picks scored) × 100

Tracked rolling windows:
- 7-day rolling
- 30-day rolling
- 90-day rolling

Reported by edge-source category (not just market-backed vs not):

```
edge_source_distribution: {
  real_edge: N,
  consensus_edge: N,
  sgo_edge: N,
  confidence_delta: N,
  explicit: N,
  unknown: N,
  total: N,
  market_backed_pct: float,
  unknown_pct: float,
}
```

---

## 3. Readiness Thresholds

### Production readiness (M4 gate)

| Metric | Minimum | Current (2026-04-15) | Status |
|--------|---------|---------------------|--------|
| Market-backed share (30-day) | ≥ 20% | ~2.6% (22/841) | **FAIL** |
| Unknown share (30-day) | ≤ 60% | ~97.4% (819/841) | **FAIL** |
| Picks with any edge attribution | ≥ 40% | ~2.6% | **FAIL** |

**Production readiness is blocked until market-backed share ≥ 20% AND unknown share ≤ 60%.**

### Syndicate / elite readiness

| Metric | Minimum |
|--------|---------|
| Market-backed share (30-day) | ≥ 60% |
| Unknown share (30-day) | ≤ 20% |
| `real-edge` or `consensus-edge` share | ≥ 40% |

---

## 4. Provenance Surfaces

### Operator pick detail page

Each pick must display:
- Edge source label (mapped from enum to human-readable: "Market-backed edge", "Consensus edge", "Single-book edge", "Confidence fallback", "Manual input", "Unknown edge source")
- Trust level label ("High trust", "Solid trust", "Medium trust", "Low trust", "Unknown trust")
- Visual tone (green for high, amber for medium, red for low/unknown)

**Current state:** The `score-insight.ts` helper in `apps/command-center/src/lib/score-insight.ts` implements this display. It reads `edgeSource` from `pick.metadata.domainAnalysis.realEdgeSource` or `pick.metadata.edgeSource`.

### Readiness dashboard / ops surfaces

The `ops:health` script and `pnpm ops:brief` must surface:
- Market-backed share (30-day rolling)
- Unknown share (30-day rolling)
- Warning when market-backed share < threshold

This is a follow-on implementation issue. The metric definition here is the contract.

### Score provenance in evidence bundles

T1 evidence bundles for production readiness (M4) must include a `score_provenance` section:

```json
{
  "score_provenance": {
    "window_days": 30,
    "total_picks": N,
    "by_edge_source": {
      "real_edge": N,
      "consensus_edge": N,
      "sgo_edge": N,
      "confidence_delta": N,
      "explicit": N,
      "unknown": N
    },
    "market_backed_pct": float,
    "unknown_pct": float,
    "threshold_pass": boolean
  }
}
```

A T1 evidence bundle with `threshold_pass: false` does not satisfy the M4 production proof gate.

---

## 5. Edge Source Resolution Order

When resolving edge source for a pick, the resolution priority is:

1. `pick.metadata.domainAnalysis.realEdgeSource` — set by real-edge service at submission time
2. `pick.metadata.realEdgeSource` — legacy top-level placement
3. `pick.metadata.edgeSource` — explicit field
4. If `promotionScores.edge` is present: `explicit`
5. If `domainAnalysis.edge` is present: `confidence-delta`
6. Otherwise: `unknown`

This resolution is implemented in `apps/command-center/src/lib/score-insight.ts:readEdgeSource()`. It must be consistent with how edge source is stored in `pick_promotion_history.metadata.scoreInputs.edgeSource`.

---

## 6. Path to Improving Market-Backed Share

The root cause of 97.4% unknown is that the real-edge computation requires:
1. A valid Pinnacle devigging result (`providerOffers` with Pinnacle lines)
2. A matching market key between the pick and the provider offer
3. A valid participant ID linkage (for player props)

Most current picks fail at step 2 (market key normalization gap) or step 3 (participant linkage gap). These are tracked separately:
- Market key normalization: partially addressed in `packages/domain/src/market-key.ts` extension
- Participant linkage: addressed in `apps/api/src/grading-service.ts` and `submission-service.ts` playerId fallback

Improving market-backed share requires fixing the ingestor → real-edge pipeline to produce matching market keys and valid participant IDs. Until that is fixed, readiness thresholds cannot be met.

---

## 7. Readiness Enforcement

### Current state

Score provenance is visible on operator surfaces (via `score-insight.ts`) but is NOT enforced at promotion-evaluation time. A pick with `unknown` edge source can still route to `trader-insights`.

### Target enforcement

Picks with `unknown` edge source should be blocked from `trader-insights` and `exclusive-insights` routing. This requires a gate in the promotion evaluation pipeline (`packages/domain/src/promotion.ts`) that checks `scoreInputs.edgeSource` and applies suppression for unknown sources targeting top-tier channels.

This enforcement is a follow-on issue. This standard defines the contract; enforcement is the implementation.

---

## 8. Why This Blocks Production Readiness

Production readiness requires analytics that are not just populated, but correct. A system that publishes picks to operator channels with 97.4% unknown provenance is making claims it cannot support. Operators cannot calibrate their trust in the score if they don't know what the score is based on.

The readiness threshold (≥ 20% market-backed, ≤ 60% unknown) is not aspirational. It is the minimum bar to claim that the scoring system is functioning as designed rather than as a black box. Until that threshold is met, the system cannot honestly close M4.
