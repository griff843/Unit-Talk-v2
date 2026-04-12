# Syndicate Machine Design

> Architecture spec for evolving Unit Talk V2 from a single-pass promotion pipeline into a full syndicate-grade pick machine: universe ingestion, multi-model scoring, portfolio-aware selection, graduated tiering, operator governance, and closed-loop feedback.

**Status:** Design — not yet implemented  
**Author:** Claude Code (PM-directed)  
**Date:** 2026-04-08

---

## Table of Contents

1. [Design Goals](#1-design-goals)
2. [Current State vs Target State](#2-current-state-vs-target-state)
3. [Layer 1 — Universe Ingestion](#3-layer-1--universe-ingestion)
4. [Layer 2 — Candidate Generation](#4-layer-2--candidate-generation)
5. [Layer 3 — Model Layer](#5-layer-3--model-layer)
6. [Layer 4 — Selection Layer](#6-layer-4--selection-layer)
7. [Layer 5 — Tiering](#7-layer-5--tiering)
8. [Layer 6 — Governance / Review](#8-layer-6--governance--review)
9. [Layer 7 — Distribution](#9-layer-7--distribution)
10. [Layer 8 — Feedback Loop](#10-layer-8--feedback-loop)
11. [Data Model Changes](#11-data-model-changes)
12. [Migration Strategy](#12-migration-strategy)
13. [Implementation Phases](#13-implementation-phases)

---

## 1. Design Goals

The current pipeline is a **submission-driven promotion system**: picks enter from external sources (smart-form, system scanner, API), get scored on five components, and route to Discord channels based on threshold-gated qualification.

The target is a **board-driven syndicate machine**: the system ingests the full universe of available markets, scores every candidate with multiple models, applies portfolio-aware selection with strict scarcity rules, assigns graduated tiers, gates output through operator governance, delivers to the right lane, and feeds every outcome back into model calibration.

**Principles:**

- **Board-first, not pick-first.** The machine sees the entire board before selecting anything. Selection is a ranking problem, not a threshold problem.
- **Multi-model, not single-score.** No single composite number decides a pick's fate. Independent models produce independent signals; the selection layer synthesizes them.
- **Scarcity-enforced.** A syndicate publishes 3-8 plays per slate, not 100. The machine must enforce scarcity at the selection layer, not rely on high thresholds to naturally limit output.
- **Portfolio-aware.** Picks are not evaluated in isolation. Correlation, exposure, and diversification matter.
- **Feedback-closed.** Every pick feeds back into model calibration, market family trust, and threshold tuning. The machine gets better over time.
- **Operator-governed.** Auto-posting is earned, not assumed. The default path goes through operator review.

---

## 2. Current State vs Target State

| Layer | Current | Target |
|---|---|---|
| **Ingestion** | SGO feed → `provider_offers` (odds snapshots, opening lines) | Multi-provider universe: all books, all props, all game lines + injury/news/limits/liquidity signals |
| **Candidate generation** | System pick scanner picks highest-prob side of opening player props | Every market line becomes a scored candidate; most discarded immediately by coarse filters |
| **Model layer** | Single 5-component score (edge/trust/readiness/uniqueness/boardFit) computed at submission time | 5+ independent models each produce structured output (fair prob, fair line, expected edge, expected CLV, confidence, failure flags) |
| **Selection** | Threshold gate: composite score >= minimum per target, with board caps (15/10/2) | Ranked selection with portfolio optimization: top N per slate enforced, max per sport/game/player/correlated-positions |
| **Tiering** | Binary: qualified or not-qualified per target | Graduated tiers assigned post-selection: premium, strong, watchlist, canary, suppress |
| **Governance** | Auto-flow (submission → promotion → distribution, no human gate) | Review queue in Command Center; operator approve/suppress/reroute; auto-post only for proven narrow class |
| **Distribution** | Outbox → Discord based on promotion_target | Tier-driven routing to canary/best-bets/trader-insights/exclusive based on tier + governance rules |
| **Feedback** | Settlement + CLV computation; CLV trust adjustment on next promotion | Full closed loop: result, CLV, miss reason, market family performance, model calibration drift, closing-line behavior → tune thresholds, weights, model trust, allowed market families |

---

## 3. Layer 1 — Universe Ingestion

### Current

`apps/ingestor` pulls SGO feeds into `provider_offers`. Each row captures a single odds snapshot: provider, event, participant, market key, over/under odds, line, opening flag, timestamp.

### Target

The ingestion layer becomes a **universe builder** that maintains a live, normalized view of every actionable market across all providers.

#### 3.1 Market Universe Table

New table: `market_universe`

```
id              UUID PRIMARY KEY
event_id        UUID FK → events
participant_id  UUID FK → participants (nullable for game-level markets)
market_key      TEXT NOT NULL          -- canonical market key (e.g., "player_points_ou")
sport           TEXT NOT NULL
league          TEXT NOT NULL

-- Consensus pricing (computed from provider_offers)
consensus_line      NUMERIC(10,2)
consensus_over_prob NUMERIC(6,4)       -- devigged
consensus_under_prob NUMERIC(6,4)      -- devigged
consensus_method    TEXT               -- 'weighted-mean' | 'median' | 'sharp-anchor'
consensus_books     INTEGER            -- number of books contributing
sharp_line          NUMERIC(10,2)      -- Pinnacle/Circa anchor (nullable)
sharp_over_prob     NUMERIC(6,4)
sharp_under_prob    NUMERIC(6,4)

-- Market metadata
market_open_at      TIMESTAMPTZ
market_close_at     TIMESTAMPTZ        -- event start or market suspension
line_move_count     INTEGER DEFAULT 0
line_move_direction TEXT               -- 'up' | 'down' | 'stable' | NULL
liquidity_tier      TEXT               -- 'high' | 'medium' | 'low' | 'unknown'
limit_tier          TEXT               -- 'full' | 'reduced' | 'minimal' | 'unknown'

-- Staleness / validity
last_update_at      TIMESTAMPTZ NOT NULL
is_actionable       BOOLEAN DEFAULT TRUE  -- false if suspended, event started, etc.
staleness_minutes   INTEGER COMPUTED      -- now() - last_update_at

-- Timestamps
created_at          TIMESTAMPTZ DEFAULT now()
updated_at          TIMESTAMPTZ DEFAULT now()
```

**Key index:** `(sport, league, is_actionable, last_update_at DESC)` for board scans.

#### 3.2 Contextual Signals

New table: `market_context_signals`

```
id              UUID PRIMARY KEY
market_id       UUID FK → market_universe
signal_type     TEXT NOT NULL    -- 'injury' | 'news' | 'lineup' | 'weather' | 'suspension'
severity        TEXT NOT NULL    -- 'critical' | 'major' | 'minor' | 'info'
source          TEXT NOT NULL    -- provider or feed name
payload         JSONB           -- structured signal data
expires_at      TIMESTAMPTZ     -- signal relevance window
created_at      TIMESTAMPTZ DEFAULT now()
```

Signals feed into the **matchup/context model** (Layer 3) and can flag markets for suppression or risk adjustment.

#### 3.3 Line Movement Tracking

New table: `line_movements`

```
id              UUID PRIMARY KEY
market_id       UUID FK → market_universe
provider_key    TEXT NOT NULL
previous_line   NUMERIC(10,2)
current_line    NUMERIC(10,2)
previous_odds   JSONB           -- {over, under}
current_odds    JSONB           -- {over, under}
move_size       NUMERIC(6,2)    -- absolute line change
move_direction  TEXT            -- 'up' | 'down'
detected_at     TIMESTAMPTZ NOT NULL
```

**Retention:** Same 30-day policy as `provider_offers`.

#### 3.4 Ingestion Cadence

| Source | Frequency | What |
|---|---|---|
| SGO feed | Every 5 min (existing) | Odds snapshots → `provider_offers` |
| Universe builder | Every 5 min (new) | Aggregate `provider_offers` → `market_universe` consensus |
| Context signals | Event-driven | Injury/news/lineup feeds → `market_context_signals` |
| Line movement detector | On every universe update | Delta detection → `line_movements` |

The universe builder is a **materialization step**, not a new external feed. It reads `provider_offers` and computes consensus pricing using the existing devigging and book-weighting logic in `packages/domain`.

---

## 4. Layer 2 — Candidate Generation

### Current

The system pick scanner (`system-pick-scanner.ts`) queries `provider_offers` for recent opening player props, deviggs them, picks the higher-probability side, and submits via `POST /api/submissions`. **Note:** This direct-submission path is transitional. Retirement is tracked in UTV2-495 (P7B-01) and UTV2-512 (P7B-02a), which will migrate the scanner to submit through the candidate layer instead.

### Target

Candidate generation becomes a **board scan** that evaluates every actionable market in `market_universe` and produces a scored candidate set. Most candidates are discarded immediately by coarse filters before reaching the expensive model layer.

#### 4.1 Candidate Record

New table: `pick_candidates`

```
id                  UUID PRIMARY KEY
market_id           UUID FK → market_universe
scan_id             UUID FK → board_scans      -- which scan produced this
side                TEXT NOT NULL               -- 'over' | 'under' | 'home' | 'away' | etc.
candidate_line      NUMERIC(10,2)
candidate_odds      INTEGER                    -- American odds at time of scan

-- Coarse filter results (fast, cheap checks)
passed_coarse       BOOLEAN NOT NULL
coarse_reject_reason TEXT                      -- null if passed

-- Model outputs (populated by Layer 3, null until scored)
model_scores        JSONB                      -- structured model output bundle
model_scored_at     TIMESTAMPTZ

-- Selection results (populated by Layer 4, null until selected)
selection_rank      INTEGER                    -- rank within slate (null if not selected)
selection_status    TEXT                       -- 'selected' | 'rejected' | 'suppressed'
selection_reason    TEXT

-- Tier (populated by Layer 5)
tier                TEXT                       -- 'premium' | 'strong' | 'watchlist' | 'canary' | 'suppress'

-- Lifecycle
status              TEXT DEFAULT 'generated'   -- 'generated' | 'scored' | 'selected' | 'tiered' | 'governed' | 'delivered' | 'expired'
created_at          TIMESTAMPTZ DEFAULT now()
expires_at          TIMESTAMPTZ               -- stale after event start
```

#### 4.2 Board Scan Record

New table: `board_scans`

```
id                  UUID PRIMARY KEY
scan_type           TEXT NOT NULL     -- 'scheduled' | 'manual' | 'triggered'
sport_filter        TEXT[]            -- null = all sports
league_filter       TEXT[]            -- null = all leagues

-- Stats
markets_scanned     INTEGER
candidates_generated INTEGER
candidates_passed_coarse INTEGER
candidates_scored   INTEGER
candidates_selected INTEGER

started_at          TIMESTAMPTZ NOT NULL
completed_at        TIMESTAMPTZ
status              TEXT DEFAULT 'running'  -- 'running' | 'completed' | 'failed'
```

#### 4.3 Coarse Filters

Coarse filters are cheap, stateless checks that discard obviously bad candidates before model scoring. They run in-process, no DB queries.

| Filter | Rule | Rationale |
|---|---|---|
| **Actionable** | `market_universe.is_actionable = true` | Don't score dead markets |
| **Minimum books** | `consensus_books >= 2` | No consensus from a single source |
| **Staleness** | `staleness_minutes < 30` | Stale data = unreliable edge |
| **Liquidity** | `liquidity_tier != 'minimal'` | Can't execute on illiquid markets |
| **Market family allowlist** | Market key in allowed families | Restrict to proven market types |
| **Sport/league active** | Sport in active sport set | Seasonal gating |
| **Event window** | Event starts within 1-48h (configurable) | Too far out = too volatile; too close = stale |

Candidates that fail coarse filters are recorded with `passed_coarse = false` and `coarse_reject_reason` for analysis, but are not scored.

---

## 5. Layer 3 — Model Layer

### Current

A single scoring pass computes five normalized 0-100 scores (edge, trust, readiness, uniqueness, boardFit) from pick metadata at submission time. These are weighted and summed into a composite score.

### Target

Multiple independent models evaluate each candidate. Each model produces structured output, not just a number. The model layer does not make selection decisions — it provides evidence for the selection layer.

#### 5.1 Model Registry

Each model is a versioned, independently deployable scoring function.

| Model | Input | Output | Purpose |
|---|---|---|---|
| **Projection** | Market universe row, historical data | `fairProbability`, `fairLine`, `projectedValue` | Core probability estimation |
| **Matchup / Context** | Market + context signals (injury, lineup, weather) | `contextAdjustment`, `contextFlags[]`, `adjustedFairProb` | Situation-aware adjustment |
| **Market Resistance** | Line movements, book agreement/disagreement | `lineStability`, `sharpMoney`, `resistanceScore`, `moveDirection` | Market intelligence |
| **CLV Expectation** | Historical CLV by market family, provider, sport | `expectedCLV`, `clvConfidence`, `historicalCLVPercentile` | Forward-looking value prediction |
| **Volatility / Risk** | Market type, time to event, historical variance | `volatilityScore`, `riskFlags[]`, `confidenceBand` | Uncertainty quantification |

#### 5.2 Model Output Bundle

```typescript
interface ModelOutputBundle {
  // Projection model
  projection: {
    fairProbability: number;       // 0-1
    fairLine: number;              // model's fair line
    projectedValue: number;        // expected value per unit
    modelVersion: string;
  };

  // Matchup / Context model
  context: {
    contextAdjustment: number;     // -1 to +1 adjustment factor
    adjustedFairProb: number;      // projection.fairProbability * (1 + adjustment)
    contextFlags: ContextFlag[];   // e.g., ['injury-impact', 'pace-factor']
    modelVersion: string;
  };

  // Market resistance model
  marketResistance: {
    lineStability: number;         // 0-100, higher = more stable
    sharpMoney: 'with' | 'against' | 'neutral';
    bookAgreement: number;         // 0-1, fraction of books aligned
    resistanceScore: number;       // 0-100
    moveDirection: 'toward-model' | 'away-from-model' | 'stable';
    modelVersion: string;
  };

  // CLV expectation model
  clvExpectation: {
    expectedCLV: number;           // expected CLV in probability points
    clvConfidence: number;         // 0-1
    historicalCLVPercentile: number; // 0-100, where this market family sits historically
    modelVersion: string;
  };

  // Volatility / Risk model
  risk: {
    volatilityScore: number;       // 0-100, higher = more volatile
    riskFlags: RiskFlag[];         // e.g., ['low-sample', 'injury-unknown', 'correlated-position']
    confidenceBand: [number, number]; // [lower, upper] bounds on fair probability
    modelVersion: string;
  };

  // Synthesis (computed from above, not a separate model)
  synthesis: {
    expectedEdge: number;          // adjustedFairProb - marketImpliedProb
    expectedCLV: number;           // from CLV model
    confidence: number;            // 0-1, synthesized from all models
    failureFlags: string[];        // aggregated flags that warrant caution
  };
}
```

#### 5.3 Model Execution

Models run in `packages/domain` as pure functions. They receive structured input and return structured output. No DB access, no side effects.

```typescript
// Each model implements this interface
interface CandidateModel<TInput, TOutput> {
  name: string;
  version: string;
  score(input: TInput): TOutput;
}
```

Model execution is orchestrated by a **model runner** service in `apps/api` (or a dedicated `apps/scorer` process for scaling). The runner:

1. Loads candidates that passed coarse filters
2. Runs all models in parallel per candidate
3. Writes the `ModelOutputBundle` to `pick_candidates.model_scores`
4. Marks candidate status as `'scored'`

#### 5.4 Model Versioning and Health

Each model output includes its version. The `model_registry` table (already specified in `MODEL_REGISTRY_CONTRACT.md`) tracks:

- Model name and version
- Calibration metrics (Brier score, log loss, CLV correlation)
- Health status (active, degraded, disabled)
- Last calibration timestamp

A degraded or disabled model produces output but sets a failure flag, which the selection layer uses to discount that signal.

---

## 6. Layer 4 — Selection Layer

### Current

The promotion service evaluates each pick independently against per-target threshold gates (minimum score, minimum edge, minimum trust, board caps). First policy that qualifies wins. This is a **threshold filter**, not a **ranking selector**.

### Target

The selection layer ranks all scored candidates and picks the best N for the slate, enforcing strict scarcity and portfolio constraints. This is the core differentiator from a retail tipster feed.

#### 6.1 Selection Criteria (Ranked)

Candidates are ranked by a **selection score** that combines model outputs with portfolio context:

```typescript
interface SelectionScore {
  // From model layer
  edgeQuality: number;         // expectedEdge * confidence
  expectedCLV: number;         // from CLV expectation model
  marketAgreement: number;     // bookAgreement * lineStability
  dataQuality: number;         // inverse of failure flag count + risk flags
  confidence: number;          // synthesis confidence

  // From portfolio context
  correlationPenalty: number;  // penalty for correlation with already-selected positions
  portfolioFit: number;        // diversification score relative to current board
  historicalPerformance: number; // track record for this market family + profile

  // Composite
  selectionScore: number;      // weighted combination
}
```

#### 6.2 Scarcity Constraints

These are hard limits enforced after ranking. Even high-scoring candidates are rejected if constraints are violated.

| Constraint | Default | Configurable |
|---|---|---|
| **Top N per slate** | 5 | `SELECTION_MAX_PER_SLATE` |
| **Max per sport** | 3 | `SELECTION_MAX_PER_SPORT` |
| **Max per game** | 1 | `SELECTION_MAX_PER_GAME` |
| **Max per player** | 1 | `SELECTION_MAX_PER_PLAYER` |
| **Max correlated positions** | 2 | `SELECTION_MAX_CORRELATED` |

These are tighter than the current board caps (15/10/2) by design. The machine should output a tight, high-conviction slate, not fill up to the cap.

#### 6.3 Selection Algorithm

```
1. Sort all scored candidates by selectionScore DESC
2. Initialize empty selected set
3. For each candidate in ranked order:
   a. Check scarcity constraints against selected set
   b. Check correlation with selected set (detectCorrelatedPicks from domain)
   c. If all constraints pass:
      - Add to selected set
      - Update portfolio state (sport counts, game counts, player counts, correlation graph)
   d. If any constraint fails:
      - Record rejection reason
      - Continue to next candidate
4. Stop when selected set reaches MAX_PER_SLATE or candidates exhausted
5. Write selection results to pick_candidates (rank, status, reason)
```

#### 6.4 Selection vs Promotion

The selection layer **replaces** the current promotion service's threshold-gating role but does **not** replace the promotion service entirely. The promotion service continues to:

- Handle smart-form submissions (human-submitted picks bypass candidate generation)
- Record promotion history for audit/replay
- Enforce operator overrides

Machine-generated candidates flow through selection. Human-submitted picks flow through promotion. Both converge at tiering.

---

## 7. Layer 5 — Tiering

### Current

Binary: `qualified` or `not_eligible` per target. The target (best-bets, trader-insights, exclusive-insights) is determined by which policy the pick qualifies for first.

### Target

Graduated tiers assigned **after** selection, based on score + risk + confidence + portfolio context. Tier determines which distribution lanes the pick is eligible for.

#### 7.1 Tier Definitions

| Tier | Criteria | Distribution Eligibility |
|---|---|---|
| **Premium** | Top 1-2 per slate. Highest edge + CLV + confidence. No failure flags. | exclusive-insights, trader-insights, best-bets |
| **Strong** | Top 3-5 per slate. Strong edge + CLV. Minor flags OK. | trader-insights, best-bets |
| **Watchlist** | Selected but not top-5 conviction. Moderate edge. | best-bets only |
| **Canary** | Below selection threshold but interesting for testing. | canary only |
| **Suppress** | Failure flags, low confidence, or operator override. | No distribution |

#### 7.2 Tier Assignment Logic

```typescript
interface TierAssignment {
  tier: 'premium' | 'strong' | 'watchlist' | 'canary' | 'suppress';
  reason: string;
  eligibleTargets: string[];  // distribution lanes this tier can reach
}

function assignTier(candidate: ScoredCandidate, slateContext: SlateContext): TierAssignment {
  // Suppress: any critical failure flags or operator suppression
  if (candidate.failureFlags.includes('critical') || candidate.operatorSuppressed) {
    return { tier: 'suppress', reason: '...', eligibleTargets: [] };
  }

  // Premium: rank 1-2 in slate, no failure flags, high confidence
  if (candidate.selectionRank <= 2 
      && candidate.failureFlags.length === 0 
      && candidate.confidence >= 0.8) {
    return { tier: 'premium', reason: '...', eligibleTargets: ['exclusive-insights', 'trader-insights', 'best-bets'] };
  }

  // Strong: rank 3-5, minor flags OK
  if (candidate.selectionRank <= 5 && candidate.confidence >= 0.65) {
    return { tier: 'strong', reason: '...', eligibleTargets: ['trader-insights', 'best-bets'] };
  }

  // Watchlist: selected but lower conviction
  if (candidate.selectionStatus === 'selected') {
    return { tier: 'watchlist', reason: '...', eligibleTargets: ['best-bets'] };
  }

  // Canary: not selected but worth tracking
  return { tier: 'canary', reason: '...', eligibleTargets: ['canary'] };
}
```

#### 7.3 Tier vs Target (Decoupling)

Today, tier and target are conflated: if a pick qualifies for trader-insights, it goes to trader-insights. In the new model:

- **Tier** = quality grade (premium/strong/watchlist/canary/suppress)
- **Target** = distribution channel (discord:best-bets, discord:trader-insights, etc.)
- **Eligible targets** = which channels a tier can reach
- **Actual target** = determined by governance layer (may be a subset of eligible targets)

This decoupling means a premium pick can be routed to best-bets only if operator governance decides, even though it's *eligible* for exclusive-insights.

---

## 8. Layer 6 — Governance / Review

### Current

No operator gate. Picks that qualify for promotion auto-flow to distribution. The only governance is operator overrides (force_promote, suppress) applied retroactively.

### Target

A **review queue** in Command Center where operators can approve, suppress, reroute, or annotate picks before they reach public channels. Auto-posting is a privilege earned by proven model classes, not the default.

#### 8.1 Governance Queue

New table: `governance_queue`

```
id                  UUID PRIMARY KEY
candidate_id        UUID FK → pick_candidates (nullable for human-submitted picks)
pick_id             UUID FK → picks (nullable until pick is materialized)
tier                TEXT NOT NULL
eligible_targets    TEXT[] NOT NULL
proposed_targets    TEXT[] NOT NULL    -- system's recommendation

-- Operator decision
decision            TEXT              -- 'approve' | 'suppress' | 'reroute' | 'hold' | NULL (pending)
decided_targets     TEXT[]            -- actual targets after decision (may differ from proposed)
decided_by          TEXT              -- operator who decided
decided_at          TIMESTAMPTZ
decision_reason     TEXT

-- Auto-post eligibility
auto_eligible       BOOLEAN DEFAULT FALSE
auto_reason         TEXT              -- why auto-post was granted or denied

-- Lifecycle
status              TEXT DEFAULT 'pending'  -- 'pending' | 'approved' | 'suppressed' | 'expired'
expires_at          TIMESTAMPTZ       -- auto-expire if not reviewed before event start
created_at          TIMESTAMPTZ DEFAULT now()
```

#### 8.2 Governance Rules

| Rule | Description |
|---|---|
| **Default: review** | All picks enter governance queue as `pending` unless auto-eligible |
| **Auto-post criteria** | Model class has 50+ graded picks, positive CLV, <15% miss rate, operator-approved for auto-post |
| **Expiry** | Pending items expire 30 min before event start |
| **Reroute** | Operator can move a premium pick down to best-bets only, or a strong pick to canary |
| **Suppress** | Operator removes pick from all distribution; recorded for feedback |
| **Hold** | Operator flags pick for discussion without expiring it |

#### 8.3 Auto-Post Class

A market family + model version qualifies for auto-post when:

```typescript
interface AutoPostCriteria {
  minGradedPicks: 50;           // minimum sample size
  minPositiveCLVRate: 0.55;     // >55% of picks beat closing line
  maxMissRate: 0.15;            // <15% gross misses (wrong side by >3 pts)
  operatorApproved: true;       // explicit operator blessing required
  modelVersion: string;         // locked to specific version
  marketFamilies: string[];     // locked to specific market families
}
```

Auto-post is revocable: if the model degrades past thresholds, auto-post is suspended and picks return to the review queue.

#### 8.4 Command Center Integration

The governance queue surfaces in Command Center's **Operations workspace** as:

- **Review Queue** panel: pending picks with model scores, tier, proposed targets
- **Approve/Suppress/Reroute** actions: one-click operator decisions
- **Auto-Post Dashboard**: which model classes are auto-eligible, their current metrics
- **Override History**: audit trail of all governance decisions

This requires Command Center write surfaces, which is a new capability (currently read-only). The write path goes through `apps/api` governance endpoints — Command Center never writes to DB directly.

---

## 9. Layer 7 — Distribution

### Current

Picks that qualify for promotion are enqueued to `distribution_outbox` with a target determined by which promotion policy qualified first. The worker polls, delivers to Discord, records receipts.

### Target

Distribution is **tier-driven and governance-gated**. Only picks that have passed governance (approved or auto-posted) are enqueued, and they go to the targets determined by the governance decision, not the promotion policy.

#### 9.1 Distribution Flow (New)

```
Governance decision (approved, targets=[best-bets, trader-insights])
  → For each approved target:
    → Validate target enabled in registry (existing)
    → Validate rollout % (existing)
    → Idempotency check (existing)
    → Enqueue to distribution_outbox
  → Worker picks up and delivers (existing)
```

The existing outbox/worker/receipt machinery is reused unchanged. The change is **what feeds the outbox**: governance decisions instead of promotion qualification.

#### 9.2 Multi-Target Delivery

A premium pick approved for multiple targets gets one outbox row per target (existing behavior). The pick's tier is included in the outbox payload so the delivery adapter can format the embed appropriately (premium picks get enhanced formatting, strong picks get standard formatting, etc.).

#### 9.3 Canary Lane

The canary lane (`discord:canary`) remains the permanent control channel. Every candidate that reaches governance — regardless of decision — gets a canary delivery for observation. This is the feedback corpus.

---

## 10. Layer 8 — Feedback Loop

### Current

Settlement records results (win/loss/push/void). CLV is computed at settlement time. CLV trust adjustment feeds into future promotion decisions. Loss attribution categorizes misses.

### Target

A comprehensive feedback system that tunes every layer of the machine.

#### 10.1 Feedback Signals

Every settled pick produces:

| Signal | Source | Feeds Into |
|---|---|---|
| **Result** | Settlement service | Win rate by model, market family, sport |
| **CLV** | CLV service | CLV by model, market family, provider |
| **Miss reason** | Loss attribution | Model blind spots, context model gaps |
| **Market family performance** | Aggregation over settled picks | Market family trust scores, allowlist tuning |
| **Model calibration drift** | Brier score, log loss over rolling windows | Model health, auto-post eligibility |
| **Closing-line behavior** | CLV distribution analysis | Market resistance model calibration |
| **Governance accuracy** | Operator suppress/approve vs outcome | Governance rule tuning |

#### 10.2 Feedback Tables

New table: `model_performance`

```
id                  UUID PRIMARY KEY
model_name          TEXT NOT NULL
model_version       TEXT NOT NULL
market_family       TEXT NOT NULL
sport               TEXT NOT NULL
period              TEXT NOT NULL        -- 'daily' | 'weekly' | 'monthly' | 'all-time'
period_start        DATE NOT NULL

-- Metrics
sample_size         INTEGER NOT NULL
win_rate            NUMERIC(5,4)
clv_mean            NUMERIC(8,4)
clv_positive_rate   NUMERIC(5,4)
brier_score         NUMERIC(8,6)
log_loss            NUMERIC(8,6)
miss_rate           NUMERIC(5,4)        -- wrong side by >3 pts
roi                 NUMERIC(8,4)

-- Thresholds
health_status       TEXT DEFAULT 'active'  -- 'active' | 'degraded' | 'disabled'
auto_post_eligible  BOOLEAN DEFAULT FALSE

computed_at         TIMESTAMPTZ DEFAULT now()
```

New table: `market_family_trust`

```
id                  UUID PRIMARY KEY
market_family       TEXT NOT NULL        -- canonical market key family
sport               TEXT NOT NULL

-- Trust metrics
sample_size         INTEGER NOT NULL
clv_mean            NUMERIC(8,4)
clv_positive_rate   NUMERIC(5,4)
edge_retention      NUMERIC(5,4)        -- fraction of expected edge retained at close
miss_rate           NUMERIC(5,4)

-- Governance
trust_tier          TEXT DEFAULT 'standard'  -- 'high' | 'standard' | 'low' | 'probation' | 'blocked'
blocked_reason      TEXT

computed_at         TIMESTAMPTZ DEFAULT now()
```

#### 10.3 Feedback → Tuning

| Feedback Signal | Tuning Target | Mechanism |
|---|---|---|
| Model Brier score drift | Model health status | Rolling window check; degrade if Brier > threshold |
| CLV positive rate by market family | Market family allowlist | Drop families below 45% CLV+ rate to probation |
| Miss rate by model version | Auto-post eligibility | Revoke auto-post if miss rate > 15% |
| Edge retention by sport | Selection weights | Increase/decrease sport confidence in selection score |
| Governance accuracy | Auto-post thresholds | If operator suppressions are <5% for a model class, consider auto-post |
| Closing-line behavior | Market resistance model | Retrain with new closing-line distributions |

#### 10.4 Feedback Cadence

| Metric | Recomputation | Trigger |
|---|---|---|
| Model performance (daily) | End of day | Scheduled job |
| Model performance (weekly) | End of week | Scheduled job |
| Market family trust | Weekly | Scheduled job |
| Auto-post eligibility | On every model performance update | Event-driven |
| Model health check | Every board scan | Inline check |

---

## 11. Data Model Changes

### New Tables

| Table | Purpose | Layer |
|---|---|---|
| `market_universe` | Normalized live market view | Ingestion |
| `market_context_signals` | Injury/news/lineup signals | Ingestion |
| `line_movements` | Line movement history | Ingestion |
| `board_scans` | Scan run metadata | Candidate generation |
| `pick_candidates` | Scored candidate records | Candidate generation + Model + Selection + Tiering |
| `governance_queue` | Operator review queue | Governance |
| `model_performance` | Model metrics over time | Feedback |
| `market_family_trust` | Market family trust scores | Feedback |

### Modified Tables

| Table | Change | Reason |
|---|---|---|
| `picks` | Add `candidate_id UUID FK → pick_candidates` | Link materialized picks back to their candidate |
| `picks` | Add `tier TEXT` | Store assigned tier on the pick |
| `pick_promotion_history` | No schema change | Continues to record promotion decisions for human-submitted picks |
| `distribution_outbox` | Add `tier TEXT` to payload | Delivery adapter can format by tier |

### Unchanged Tables

`provider_offers`, `submissions`, `submission_events`, `pick_lifecycle`, `settlement_records`, `distribution_receipts`, `audit_log` — all unchanged.

---

## 12. Migration Strategy

The syndicate machine is built **alongside** the existing pipeline, not as a replacement. Both paths converge at distribution.

### Phase Model

```
Existing pipeline (human submissions):
  smart-form / API → submission-service → promotion-service → distribution → worker

New pipeline (machine candidates):
  universe → candidates → models → selection → tiering → governance → distribution → worker
                                                                              ↑
                                                              (same outbox + worker)
```

During transition:
- Human-submitted picks continue through the existing promotion path
- Machine candidates flow through the new path
- Both enter the same `distribution_outbox` and use the same worker
- Governance queue handles both (human picks get fast-tracked if from trusted operators)

### Backward Compatibility

- All existing contracts remain valid
- Existing promotion service continues to serve human submissions
- Existing scoring profiles continue to work for human picks
- New candidate/selection/tiering logic lives in new service files, not modifications to existing services
- Feature-gated: `SYNDICATE_MACHINE_ENABLED=true` to activate new pipeline

---

## 13. Implementation Phases

### Phase 1 — Universe & Candidate Foundation

**Scope:** Build the data foundation. No model changes yet.

- Migrate `market_universe` table
- Build universe materializer (aggregate `provider_offers` → consensus)
- Build `line_movements` detector
- Build board scan framework with coarse filters
- Build `pick_candidates` table and candidate generation
- Wire into existing system pick scanner as an alternative path (feature-gated)

**Verification:** Board scans produce candidates from live `provider_offers` data. Candidates visible in Command Center.

### Phase 2 — Multi-Model Scoring

**Scope:** Extract current single-score into model interface, then add models.

- Define `CandidateModel` interface in `@unit-talk/contracts`
- Refactor existing edge/trust/readiness/uniqueness/boardFit computation into Projection and Risk models
- Add Market Resistance model (using `line_movements` data)
- Add CLV Expectation model (using historical CLV from `settlement_records`)
- Build model runner that scores candidates and writes `ModelOutputBundle`
- Wire model health into `model_registry`

**Verification:** Candidates scored by multiple models. Model outputs visible in Command Center. Historical back-test against settled picks shows model signal quality.

### Phase 3 — Selection & Tiering

**Scope:** Replace threshold-gating with ranked selection for machine candidates.

- Build selection algorithm with portfolio-aware ranking
- Implement scarcity constraints (5/3/1/1/2 defaults)
- Build tiering logic (premium/strong/watchlist/canary/suppress)
- Add `tier` to picks and distribution payload
- Shadow mode: run selection alongside existing promotion, compare outputs

**Verification:** Selection produces tighter slates than current promotion. Tier distribution matches expected proportions. Shadow comparison shows selection outperforms threshold-gating on CLV.

### Phase 4 — Governance Queue

**Scope:** Add operator review before distribution.

- Build governance queue table and API endpoints
- Build Command Center review UI (Operations workspace)
- Wire governance between tiering and distribution
- Implement auto-post criteria and eligibility checks
- Default all machine picks to review; human picks configurable

**Verification:** Picks appear in review queue. Operator actions (approve/suppress/reroute) work. Auto-post disabled by default. Distribution only occurs after governance decision.

### Phase 5 — Feedback Loop

**Scope:** Close the loop.

- Build `model_performance` aggregation jobs
- Build `market_family_trust` scoring
- Wire feedback into model health checks
- Wire feedback into auto-post eligibility
- Build feedback dashboard in Command Center (Intelligence workspace)
- Implement threshold auto-tuning (with operator confirmation)

**Verification:** Model performance tracked over time. Market families scored. Auto-post eligibility computed correctly. Feedback visible in Command Center.

---

## Open Questions

1. **Dedicated scorer process?** Should model scoring run in `apps/api` or a new `apps/scorer` app? Depends on load — if board scans produce 1000+ candidates per cycle, a dedicated process avoids blocking the API.

2. **Real-time vs batch selection?** Current design is batch (per board scan). Should selection also run on-demand when a new high-value candidate appears mid-scan?

3. **Projection model source of truth?** The current system uses submitted confidence + provider odds for edge. The projection model needs its own probability estimates. What is the initial data source for fair probability — historical performance models, consensus devig, or an external projection feed?

4. **Command Center write authority?** Currently read-only. Governance requires write surfaces. What is the auth model for operator actions?

5. **Auto-post timeline?** Should auto-post be available from Phase 4 launch, or should it require N weeks of governance data before activation?
