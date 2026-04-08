# CC Decision Workspace — Advanced Decision Overlays Spec

> **Linear:** UTV2-419
> **Type:** Requirements spec — no migration, no implementation
> **Status:** Spec complete. Full implementation blocked by live multi-book line data (UTV2-431 / UTV2-433).
> **Workspace:** Decision (Track C — Advanced Overlays)

---

## Purpose

This document defines the display format and data dependencies for three advanced decision overlays in the Command Center Decision workspace:

1. **Middling opportunity** — two-sided line discrepancy exploit
2. **Hedge advice** — correlated-risk reduction framing
3. **Board fit / conflict / saturation** — portfolio health visualization

All formats are grounded in confirmed domain logic from `packages/domain/src/hedge-detection.ts` and `packages/contracts/src/promotion.ts`. Nothing in this spec requires a migration.

---

## 1. Middling Opportunity Display Format

### Source of truth

`HedgeOpportunity` (type = `'middle'`) — `packages/domain/src/hedge-detection.ts` (confirmed)

Threshold: `middleGap >= HEDGE_DETECTION_THRESHOLDS.minMiddleGap` (2.0 points)

### Display card format

```typescript
interface MiddleOpportunityCard {
  // Identity
  overlay_type: 'middle';
  event_id: string;              // providerEventId
  market_key: string;            // e.g. 'player_points'
  participant_id: string | null;

  // Line context
  book_a: string;                // bookmakerA
  book_b: string;                // bookmakerB
  line_a: number;                // lineA (lower)
  line_b: number;                // lineB (higher)
  middle_gap: number;            // lineB - lineA; meaningful when >= 2.0

  // Odds context
  over_odds_a: number;           // American odds for over at book_a
  under_odds_b: number;          // American odds for under at book_b

  // Probability breakdown
  implied_prob_a: number;        // devigged probability for over side
  implied_prob_b: number;        // devigged probability for under side
  total_implied_prob: number;    // should be < 1.0 for a true arb window
  win_probability: number | null; // P(stat lands in middle window)

  // Summary
  priority: 'low' | 'medium' | 'high' | 'critical';
  profit_potential: number;      // expected value per unit in the middle
  detected_at: string;           // ISO timestamp

  // Display labels
  label: string;                 // e.g. "LeBron Points 24.5 / 27.5 — 3.0pt middle"
  description: string;           // e.g. "Take over at FanDuel, under at DraftKings"
}
```

### UI rules

- Show only when `middle_gap >= 2.0` (domain threshold)
- Sort by `priority` descending, then `win_probability` descending
- Mark `priority = 'critical'` cards with distinct visual treatment
- Display `total_implied_prob < 1.0` as the "edge" indicator (green)
- Collapse stale cards (> 15 minutes since detection per `lookbackMinutes`)

### Data dependency

| Field | Available now | Blocked by |
|-------|:---:|---|
| `line_a/b`, `odds`, `middle_gap` | No | UTV2-431 (live multi-book ingest) |
| `win_probability` | No | Requires live stat distribution (UTV2-433) |
| `priority`, `profit_potential` | No | Requires live data |

**All middling display is blocked.** The format is fully specified. The `detectHedgeOpportunities()` function in domain is ready to produce this output when live data flows.

---

## 2. Hedge Advice Display Format

### Source of truth

`HedgeOpportunity` (type = `'hedge'` or `'arbitrage'`) — `packages/domain/src/hedge-detection.ts` (confirmed)

Threshold: `lineDiscrepancy >= HEDGE_DETECTION_THRESHOLDS.minHedgeDiscrepancy` (3.0 points)

### Display card format

```typescript
interface HedgeAdviceCard {
  // Identity
  overlay_type: 'hedge' | 'arbitrage';
  event_id: string;
  market_key: string;
  participant_id: string | null;

  // Line context
  book_a: string;
  book_b: string;
  line_a: number;
  line_b: number;
  line_discrepancy: number;     // absolute difference; >= 3.0 for hedge, 0 for arb

  // Arbitrage-specific
  arbitrage_percentage: number | null;  // > 0 = true arb; guaranteed_profit available
  guaranteed_profit: number | null;     // per unit staked (null for hedge, set for arb)

  // Risk framing
  implied_prob_a: number;
  implied_prob_b: number;
  total_implied_prob: number;   // < 100% = arb; > 100% = hedge (no-arb, risk reduction)

  // Summary
  priority: 'low' | 'medium' | 'high' | 'critical';
  detected_at: string;

  // Display labels
  label: string;                // e.g. "Curry 3PM — Hedge: 4.5 FD vs 7.5 DK"
  description: string;          // explains the two sides and the edge
  hedge_rationale: string;      // plain-language risk framing
}
```

### Hedge vs arbitrage framing rules

| Condition | Overlay type | Framing |
|-----------|---|---|
| `total_implied_prob < 1.0` | `arbitrage` | "Guaranteed profit available" |
| `total_implied_prob >= 1.0`, `line_discrepancy >= 3.0` | `hedge` | "Risk reduction opportunity" |

### UI rules

- Arbitrage cards appear above hedge cards (higher priority)
- Show `guaranteed_profit` prominently for arbitrage type (formatted as `+$X.XX per $100`)
- Hedge cards show risk-reduction framing, not guaranteed profit
- Flash animation for `priority = 'critical'` new detections
- Deduplicate: one card per `(event_id, market_key, participant_id)` pair

### Data dependency

| Field | Available now | Blocked by |
|-------|:---:|---|
| All hedge/arb overlay fields | No | UTV2-431 (live multi-book ingest) |

**All hedge display is blocked.** Domain logic is confirmed ready.

---

## 3. Board Fit / Conflict / Saturation Visualization Format

### Source of truth

`PromotionBoardState`, `PromotionBoardCaps`, `PromotionScoreBreakdown` — `packages/contracts/src/promotion.ts` (confirmed)
`pick_promotion_history` table — live data available now

### What "board state" means

The promotion system enforces three caps per slate:

| Cap dimension | Current threshold | Source |
|---|---|---|
| `perSlate` | 15 | `bestBetsPromotionPolicy.boardCaps.perSlate` |
| `perSport` | 10 | `bestBetsPromotionPolicy.boardCaps.perSport` |
| `perGame` | 2 | `bestBetsPromotionPolicy.boardCaps.perGame` |

### Board visualization format

```typescript
interface BoardStateVisualization {
  // Per-cap utilization (can be computed from pick_promotion_history now)
  slate: {
    current: number;        // currentBoardCount
    cap: number;            // perSlate
    utilization: number;    // current / cap (0–1)
    status: 'open' | 'near-cap' | 'at-cap';
  };
  by_sport: Array<{
    sport_key: string;
    current: number;        // sameSportCount
    cap: number;            // perSport
    utilization: number;
    status: 'open' | 'near-cap' | 'at-cap';
  }>;
  by_game: Array<{
    game_id: string;
    current: number;        // sameGameCount
    cap: number;            // perGame
    utilization: number;
    status: 'open' | 'near-cap' | 'at-cap';
  }>;
}

// Status thresholds
// 'near-cap': utilization >= 0.75
// 'at-cap':   utilization >= 1.0
```

### Score breakdown visualization

```typescript
// Derived from PromotionScoreBreakdown — confirmed type
interface ScoreBreakdownViz {
  pick_id: string;
  target: 'best-bets' | 'trader-insights' | 'exclusive-insights';
  total_score: number;       // 0–100
  threshold: number;         // minimumScore from policy

  components: {
    edge: number;            // 0–100
    trust: number;
    readiness: number;
    uniqueness: number;      // currently hardcoded 50 — see Known Gap below
    boardFit: number;
  };
  weights: {
    edge: number;            // from policy (e.g. 0.40)
    trust: number;
    readiness: number;
    uniqueness: number;
    boardFit: number;
  };

  // Visualization helpers
  components_weighted: {
    edge: number;            // components.edge * weights.edge
    trust: number;
    readiness: number;
    uniqueness: number;
    boardFit: number;
  };
  threshold_delta: number;   // total_score - threshold (positive = qualified)
  qualified: boolean;
}
```

### Conflict visualization format

```typescript
interface BoardConflictCard {
  // A pick that was blocked due to board cap saturation
  pick_id: string;
  player_name: string;
  sport_key: string;
  market_key: string;
  score: number;             // would have qualified on score alone

  // Why it was blocked
  conflict_reason: 'slate-cap' | 'sport-cap' | 'game-cap' | 'duplicate';
  blocking_pick_ids: string[];    // picks on the board that caused the block

  // Impact
  utilization_at_block: number;   // utilization of the blocking cap dimension
  detected_at: string;
}
```

### UI rules

- Board capacity gauge: horizontal bar, color-coded (green → yellow → red)
- Score breakdown: stacked bar chart, one segment per component, scaled by weight
- Conflict cards: display only when `threshold_delta > 0` and qualified = false (would qualify but was capped)
- Sort conflicts by `score` descending (highest-scoring blocked picks first)

### Data dependency

| Feature | Available now | Blocked by |
|---------|:---:|---|
| Board capacity gauge (slate/sport/game) | **Yes** | — (from `pick_promotion_history`) |
| Score breakdown visualization | **Yes** | — (from `pick_promotion_history.score_breakdown`) |
| Conflict visualization | **Yes** | — (from `pick_promotion_history` rejection records) |
| Live line freshness on conflict cards | No | UTV2-431 |

**Board fit / conflict / saturation visualization is fully unblocked.** This is the only overlay that can ship without live data.

---

## 4. Dependency Map — Ship vs Blocked

| Overlay | Can ship without live data | Blocked by | What is missing |
|---------|:---:|---|---|
| Middling opportunities | No | UTV2-431 | Live multi-book ingest |
| Hedge / arbitrage advice | No | UTV2-431 | Live multi-book ingest |
| Board capacity gauge | **Yes** | — | Nothing |
| Score breakdown visualization | **Yes** | — | Nothing |
| Conflict visualization | **Yes** | — | Nothing |
| Line freshness on conflict cards | No | UTV2-431 | Live data |
| Stat win probability in middles | No | UTV2-433 | Player enrichment |

### Unblocked implementation path

The following can be implemented against `pick_promotion_history` data that is **live today**:

1. Board capacity gauge (slate / sport / game utilization bars)
2. Score breakdown per pick (weighted stacked bar)
3. Conflict cards (blocked-but-would-qualify picks with cap explanation)

These three do not require UTV2-431, UTV2-433, or any migration.

---

## Known Gaps

1. **`uniqueness` score** — currently hardcoded to 50 in `apps/api/src/promotion-service.ts`. No signal is wired. Score breakdown visualization should show this clearly (grey or "no signal" indicator on the uniqueness bar).

2. **Guaranteed profit calculation** — `guaranteedProfit` from `detectHedgeOpportunities()` assumes optimal stake sizing. Display should note this is an estimate.

3. **Real-time refresh** — Hedge/middle overlays require sub-minute data freshness to be actionable. Polling interval must be specified when implementation begins (out of scope for this spec).

---

## Confirmed Sources

| Shape | Source |
|-------|--------|
| `HedgeOpportunity`, `HedgeOpportunityType`, `HedgeOpportunityPriority` | `packages/domain/src/hedge-detection.ts` |
| `HEDGE_DETECTION_THRESHOLDS` | `packages/domain/src/hedge-detection.ts` |
| `PromotionBoardState`, `PromotionBoardCaps` | `packages/contracts/src/promotion.ts` |
| `PromotionScoreBreakdown`, `PromotionScoreWeights` | `packages/contracts/src/promotion.ts` |
| Board cap values (`perSlate: 15`, `perSport: 10`, `perGame: 2`) | `packages/contracts/src/promotion.ts` (`bestBetsPromotionPolicy.boardCaps`) |
| `pick_promotion_history` live data | Supabase (migration `202604020001` or earlier) |
