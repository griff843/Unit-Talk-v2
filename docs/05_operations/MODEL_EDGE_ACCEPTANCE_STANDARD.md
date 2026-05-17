# Model Edge Acceptance Standard — UTV2-999

**Status:** Draft for PM ratification  
**Owner:** Claude (draft) + PM (ratification)  
**Effective:** Upon PM merge approval  
**Supersedes:** All informal "Strong/Elite" edge claims

---

## Purpose

This document defines the minimum statistical standards that any model, cohort, or pick set must satisfy before an edge label (`Unproven`, `Developing`, `Strong`, `Elite`) or syndicate-readiness claim may be asserted. It is a hard gate — the system must not self-ratify using narrative confidence.

---

## Edge Labels and Their Requirements

### Label: UNPROVEN

Assigned when **any** of the following is true:
- Sample size is below the minimum for the claimed market/cohort (see § Sample Size Minimums)
- Out-of-sample proof has not been produced
- CLV data coverage is below 60% of settlements
- Claim uses confidence-proxy scoring (capper star rating, model confidence score, etc.) as the primary evidence
- Most recent evidence is older than 90 days

**Interpretation:** Cannot be cited as evidence of production edge. Requires ongoing measurement.

---

### Label: DEVELOPING

Minimum requirements (all must be met):
| Dimension | Minimum |
|---|---|
| In-sample bets | ≥ 50 settled bets in the cohort |
| Out-of-sample bets | ≥ 20 bets held out from training |
| Win rate CI | 90% confidence interval must not include 0.500 for a spread market |
| CLV coverage | ≥ 60% of settlements have CLV payload |
| CLV direction | Positive median CLV (beating fair market) over the cohort |
| ROI | Positive ROI at true closing odds (not opening line) |
| Data freshness | Most recent evidence within 30 days |

**Interpretation:** Sufficient for internal monitoring. Insufficient for syndicate-readiness claims.

---

### Label: STRONG

Minimum requirements (all must be met):
| Dimension | Minimum |
|---|---|
| In-sample bets | ≥ 200 settled bets in the cohort |
| Out-of-sample bets | ≥ 100 bets held out from training (temporally, not randomly) |
| Win rate CI | 95% confidence interval must exclude 0.500 for spread; 0.476 for moneyline |
| CLV coverage | ≥ 80% of settlements have CLV payload |
| CLV median | +0.5% or better vs closing fair value |
| CLV 25th percentile | Positive (>0%) — not just median |
| ROI | ≥ +2% at closing odds over the full sample |
| ROI confidence | 90% CI on ROI must not include 0% |
| Calibration | Predicted win rate within ±5 percentage points of actual win rate |
| Band accuracy | Within ±10% of predicted confidence band for 80% of outcomes |
| Data freshness | Most recent evidence within 14 days |
| Stale bets | Bets settled more than 180 days ago excluded from primary ROI calc |

**Interpretation:** Sufficient for limited production use with monitoring. Cannot be cited for syndicate capital allocation without Elite proof.

---

### Label: ELITE

Minimum requirements (all must be met — in addition to all STRONG requirements):
| Dimension | Minimum |
|---|---|
| In-sample bets | ≥ 500 settled bets in the cohort |
| Out-of-sample bets | ≥ 250 bets held out from training (temporally) |
| Win rate CI | 99% confidence interval must exclude break-even |
| CLV coverage | ≥ 90% of settlements have CLV payload |
| CLV median | +1.5% or better vs closing fair value |
| CLV 25th percentile | +0.3% or better |
| CLV 10th percentile | Positive (>0%) |
| ROI | ≥ +4% at closing odds over the full sample |
| ROI confidence | 95% CI on ROI must not include 0% |
| Calibration | Predicted win rate within ±3 percentage points of actual |
| Band accuracy | Within ±7% of predicted confidence band for 80% of outcomes |
| Market depth | At least 2 distinct sports or bet types covered |
| Stability | Performance maintained over at least 2 non-overlapping 90-day windows |
| Data freshness | Most recent evidence within 7 days |

**Interpretation:** Required before any syndicate-readiness capital-allocation claims.

---

### Label: SYNDICATE_READY

SYNDICATE_READY is not a model label — it is a system-level verdict. It requires:
- At least one cohort at ELITE tier
- Pipeline delivering picks from that cohort in production
- CLV data arriving within 24h of settlement
- ROI dashboard displaying closing-line-based ROI (not opening line)
- Delivery confirmation (Discord receipt within SLO) for ≥ 95% of picks
- No FAILED runtime health signals for 72h continuous

---

## Sample Size Minimums by Context

| Context | Minimum N (in-sample) | Minimum N (out-of-sample) |
|---|---|---|
| Single sport, single market | 200 | 100 |
| Single sport, multiple markets | 150 per market | 75 per market |
| Multiple sports, same bet type | 300 total | 150 total |
| Multiple sports, multiple markets | 400 total | 200 total |
| Parlay/same-game parlay | 500 | 250 |
| Live/in-play | 300 | 150 |

Below-minimum samples **must** produce `UNPROVEN`, not any positive label.

---

## CLV Requirements

CLV (Closing Line Value) is the primary edge signal. All CLV calculations must:

1. **Use closing fair odds** — not opening line, not Pinnacle line alone unless Pinnacle is truly the sharpest available
2. **Exclude juice** — calculate fair value by removing the book's margin
3. **Track per-pick** — not just aggregates
4. **Cover settlement records** — CLV attached to `settlement_records.payload` with fields: `clvRaw`, `clvPercent`, `beatsClosingLine`

CLV coverage below 60%: UNPROVEN  
CLV coverage 60–80%: may use median CLV but must note coverage gap  
CLV coverage ≥ 80%: full CLV evidence acceptable

---

## Temporal Out-of-Sample Requirements

Out-of-sample testing must be **temporal** (time-based), not random:

- Training window closes at date T
- Out-of-sample picks are those placed after T
- Walk-forward validation preferred over single train/test split
- Minimum gap between training end and evaluation start: 30 days

Random 80/20 splits are not accepted as out-of-sample proof because future picks could leak into training.

---

## Stale Data Exclusion Rules

| Evidence age | Treatment |
|---|---|
| < 14 days | Fully valid |
| 14–90 days | Valid with freshness disclosure |
| 90–180 days | Valid for DEVELOPING; note required for STRONG/ELITE |
| > 180 days | Excluded from primary edge metric; may appear in historical tables only |
| > 365 days | Must not appear in any edge claims |

Market conditions change. Evidence older than 90 days must be re-validated against recent performance.

---

## Invalidation Conditions

An edge label is immediately reverted to UNPROVEN when any of the following occurs:

1. 30-consecutive-pick losing streak at fair odds (statistical signal of distributional shift)
2. CLV coverage drops below 50% for 14+ consecutive days
3. ROI over trailing 100 bets becomes negative at 95% CI
4. Calibration error exceeds ±10 pp for 3 consecutive weeks
5. Model re-training occurs (performance reverts to UNPROVEN pending re-validation)
6. Runtime proof becomes stale (evidence SHA diverges from current production SHA)
7. PM-initiated reset (override with audit log entry)

---

## Prohibited Claims

The following formulations are prohibited without meeting STRONG or ELITE thresholds:

- "High confidence" without CI data
- "Proven edge" without out-of-sample N ≥ 100
- "Positive EV" without CLV coverage ≥ 60%
- "Syndicate-ready" without ELITE label on at least one cohort
- Any win-rate claim citing N < 50

Violations should be treated as governance failures equivalent to a truth-check fail.

---

## Measurement Cadence

| Label | Re-measurement frequency |
|---|---|
| UNPROVEN | On-demand only |
| DEVELOPING | Monthly |
| STRONG | Weekly |
| ELITE | Daily (automated) |

ELITE claims require automated monitoring. Manual re-validation alone is not sufficient once the label is asserted.

---

## Ratification

This standard takes effect upon PM merge approval of the UTV2-999 PR. All prior narrative edge claims are superseded. A measurement run against this standard must be completed within 30 days of ratification.

**Draft author:** Claude Sonnet 4.6 (UTV2-999)  
**PM ratification:** _(signature required at merge)_
