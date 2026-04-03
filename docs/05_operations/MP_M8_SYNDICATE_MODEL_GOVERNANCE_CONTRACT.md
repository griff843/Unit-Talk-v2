# MP-M8: Syndicate Model Review Cadence and Portfolio Governance Contract

**Status:** RATIFIED 2026-04-03  
**Linear:** UTV2-325  
**Tier:** DOCS  
**Lane:** claude  
**Milestone:** MP-M8: Syndicate Governance

---

## Purpose

This contract defines the operating governance layer for the Sports Modeling Program at syndicate scale. It establishes who reviews what, when, on what metrics, and how model decisions interact with bankroll, exposure, and portfolio concentration.

This document does not require a code change. It is the operational contract that MP-M9+ implementation work must satisfy.

---

## Review Cadence

### Weekly Model Review (every Monday)

**Who:** Operator (PM) + Quantitative lead (if separate)  
**Format:** Standing 30-min async review packet, escalate to sync only if alert-level issues exist

**Mandatory review packet contents:**

| Metric | Description | Alert threshold |
|--------|-------------|-----------------|
| Win rate (last 7 days) | By sport, by market family | < 45% → warning; < 40% → critical |
| ROI (last 7 days) | Net units by sport and target channel | < -5% → warning; < -10% → critical |
| Sample size | Picks graded in window | < 10 per sport → note (small-sample caveat) |
| Drift score | Delta from rolling 30-day baseline | > 0.15 absolute → warning; > 0.25 → critical |
| Calibration score | Predicted vs actual win rate alignment | > 0.10 gap → warning; > 0.20 → critical |
| Board saturation | Cap hit rate by sport / slate / game | > 70% average cap utilization → review urgency |
| Champion model age | Days since last champion promotion | > 90 days without review → flag |
| Challenger pipeline | Count of staged/challenger models | 0 challengers for any active sport → flag |

**Required outputs from each weekly review:**

1. Health status for each active champion model: `green | watch | warning | critical`
2. Any champion demotion decisions (triggers automatic `updateStatus(id, 'archived')`)
3. Any challenger promotion decisions (triggers automatic `updateStatus(id, 'champion')`)
4. Recalibration work orders logged to Linear if drift > warning threshold
5. Board cap adjustments (requires PM decision, updates `@unit-talk/contracts` promotion policies)

---

### Monthly Portfolio Review (first Monday of month)

**Who:** Operator (PM)  
**Format:** Full portfolio read — async packet + sync decision session

**Mandatory monthly packet contents (in addition to weekly):**

| Review area | Description |
|-------------|-------------|
| 30-day ROI by sport | Full P/L read with confidence intervals |
| Champion stability | Win rate trend direction (improving / stable / declining) |
| Model version history | All promotions, demotions, experiments in the past 30 days |
| Experiment ledger review | Completed backtest/eval runs; results vs hypothesis |
| Book performance | Per-provider line capture delta (from `ExecutionQualityRepository`) |
| Market family coverage | Which sport/market pairs have active champions vs gaps |
| Concentration risk | Portfolio exposure by sport (see §4 below) |

**Required outputs from each monthly review:**

1. Updated portfolio health summary (written to program status doc)
2. Go/no-go on any shadow mode activations (see MP-M7)
3. Active experiment decisions: continue, stop, promote, archive
4. Bankroll allocation adjustments if concentration limits are breached (see §4)

---

## Who Reviews What

| Model type | Weekly reviewer | Monthly reviewer | Demotion authority |
|------------|----------------|------------------|-------------------|
| Active champion (best-bets) | Operator | Operator | Operator |
| Active champion (trader-insights) | Operator | Operator | Operator |
| Active champion (exclusive-insights) | Operator | Operator | Operator (T1 decision) |
| Challenger models | Operator | Operator | Self-demotes on poor backtest |
| Staged models | Operator (async flag review) | Operator | N/A — never reaches Discord |
| Archived models | No ongoing review | — | Already terminal |

**Demotion authority note:** exclusive-insights champion demotion requires PM review because it gates the highest-tier VIP content. It is a T1 decision.

---

## Bankroll, Exposure, and Portfolio Concentration

### Concentration limits

The following limits apply to the active portfolio of promoted picks across all channels:

| Dimension | Soft limit | Hard limit | Action at breach |
|-----------|-----------|------------|-----------------|
| Single sport share | 60% of weekly volume | 75% | Reduce picks from over-represented sport; flag in weekly review |
| Single market family share | 50% of weekly volume | 65% | Review model concentration; consider adding challenger for under-served markets |
| Single capper share (non-system) | 30% of weekly volume | 40% | Rate-limit or temporary pause for that capper |
| System-generated share (`source: alert-agent`) | 40% of weekly volume | 55% | Review `SYSTEM_PICKS_ENABLED` threshold; reduce alert-worthy sensitivity |

### Model confidence and bankroll sizing

Picks do not carry explicit bankroll sizing in the current system. The interaction between model confidence and sizing follows these rules:

1. **High-confidence picks** (`confidence >= 0.8`) are eligible for exclusive-insights with max board visibility
2. **Medium-confidence picks** (`0.65 <= confidence < 0.8`) are eligible for best-bets and trader-insights
3. **Alert-agent picks** (`source: 'alert-agent'`, confidence 0.65) are treated as medium-confidence — they bypass the confidence floor because the confidence value is deliberate, not inferred
4. **Below-floor picks** (confidence < floor, not from bypassed sources) are blocked from promotion — no board sizing decision is made for them

**Future integration point (MP-M7 / shadow mode):** When shadow mode is active, model-driven picks carry a shadow confidence score that will feed directly into sizing signals. This contract will be updated when shadow mode goes live.

---

## How New Books, Markets, and Sports Enter the Promoted Universe

### New sportsbook / provider

**Entry process:**
1. Provider added to `provider_offers` ingest via `apps/ingestor` config
2. Minimum 30-day data collection before any line capture analysis
3. `ExecutionQualityRepository.summarizeByProvider()` reviewed at 30-day mark
4. If `avgLineDelta >= 0` (neutral or favorable line capture): eligible for routing
5. Operator creates Linear issue to update routing/urgency preferences
6. No code change required unless default routing priority changes

**Exit (remove from routing):**
- `avgLineDelta < -0.03` sustained over 30+ day window → flag for demotion from routing priority
- PM decision required to explicitly remove a provider from routing

### New market family

**Entry process:**
1. Market family must have canonical taxonomy entry in `canonical_market_taxonomy` table
2. Minimum 50 graded picks in the market family before champion model consideration
3. Backtest run (via `experiment_ledger`, `run_type: 'backtest'`) with minimum 200 historical samples
4. Backtest result reviewed in monthly review
5. If win rate > 52% with sample size >= 200: eligible for champion promotion consideration
6. PM decision to promote challenger to champion for that market family

**Exit:**
- Market family with < 5 picks per 30-day window → flag as inactive
- Active champion with < 45% win rate over 60-day window → demotion trigger

### New sport

**Entry process (this is the highest-friction path):**
1. Feature inventory and dataset availability audit (output: Linear proof issue, same pattern as UTV2-320–323)
2. Canonical training dataset extraction proof
3. Baseline model architecture selection and walk-forward evaluation
4. Shadow mode activation (MP-M7) — minimum 21 days in shadow before any live promotion
5. Monthly review presentation with full backtest evidence
6. PM decision to exit shadow and activate champion promotion
7. This process takes a minimum of 90 days from start to first live pick

**Exit:**
- Sport removed from active model program if no picks in 90-day window (likely seasonal — freeze don't delete)
- Champion archived if win rate < 40% over 60-day window AND no challenger ready

---

## Experiment Review Workflow

When a new experiment run completes (`experiment_ledger.status = 'completed'`):

1. Review `metrics` field in the ledger row
2. Compare against champion model's most recent `model_health_snapshots` baseline
3. Decision tree:
   - Experiment ROI > champion ROI by >= 2% over same period → **promote to challenger, begin parallel tracking**
   - Experiment ROI within ±2% of champion → **archive experiment, no change**
   - Experiment ROI < champion ROI by > 2% → **archive experiment, note failure reason in `notes` field**
4. Challenger tracks in parallel with champion for minimum 30 days before any demotion decision
5. All decisions logged as a comment on the Linear issue and as a `model_health_snapshots` record

---

## Governance Triggers Requiring PM (T1) Decisions

The following always require explicit PM decision — never automated:

1. Promoting a challenger to champion for any active target
2. Demoting an exclusive-insights champion
3. Activating a new sport in the live promotion pipeline
4. Removing a provider from routing
5. Adjusting board caps in `@unit-talk/contracts` promotion policies
6. Enabling shadow mode (`MP-M7`) for any sport
7. Setting `SYSTEM_PICKS_ENABLED=true` in production

---

## Integration with Existing Systems

| System | Integration point |
|--------|------------------|
| `model_registry` | Champion/challenger status is runtime truth. `findChampion(sport, marketFamily)` is the authoritative query. |
| `experiment_ledger` | All training/eval/backtest/calibration runs logged here. Review via `listByModelId()`. |
| `model_health_snapshots` | Weekly health snapshots stored here. Alert level drives review urgency. |
| `ExecutionQualityRepository` | Monthly book performance review. `summarizeByProvider()` and `summarizeByMarketFamily()`. |
| `pick_promotion_history` | Every promotion decision includes `metadata.scoringProfile` and `metadata.policyVersion`. |
| Linear | All decisions logged as issue comments or new tracking issues. |

---

## What This Contract Does NOT Cover

- Actual model training infrastructure (ML pipelines, feature stores, training jobs) — outside the scope of this repo
- Bankroll management tooling — future work (syndicate readiness)
- Automated alerting / PagerDuty integration — PI-M5 scope
- Regulatory compliance around pick content — separate legal track

---

## Ratification

This contract is ratified as of 2026-04-03 and becomes the operating governance standard for the Sports Modeling Program.

The model registry foundation (UTV2-317) and model ops layer (UTV2-318/319) provide the runtime infrastructure this contract depends on.

Next required step: MP-M3 (NBA baseline model, UTV2-320) — the first sport slice to operate under this governance framework.
