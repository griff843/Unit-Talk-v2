# Competitor Benchmark — Prop Tools Feature Matrix

**Issue:** UTV2-416
**Date:** 2026-04-07
**Status:** Ratified — gates Command Center Intelligence and Research workspace feature prioritization
**Authority:** This document is the canonical competitive positioning reference for Unit Talk Command Center. It informs which features to adopt, improve, or reject when building the Intelligence and Research workspaces.

**Knowledge basis:** Author knowledge as of mid-2025 training cutoff. Claims marked `[verify]` should be confirmed against current product reality before acting on them. No live web access was used.

---

## Section 1 — Feature Matrix

Rows = features. Columns = PropsMadness / Outlier / Props Cash / Unit Talk (current) / Unit Talk (target).

Ratings: `Y` = full feature, `P` = partial, `N` = not present, `S` = shell/limited.

| Feature | PropsMadness | Outlier | Props Cash | Unit Talk (current) | Unit Talk (target) |
|---|---|---|---|---|---|
| **Prop line browsing / market explorer** | Y | Y | Y | N (no Research workspace yet) | Y (Prop Explorer module) |
| **Multi-book line comparison** | Y | P [verify] | Y | N | Y (Line-Shopper module) |
| **Player stat context / card** | Y | Y | N [verify] | N | P (identity + pick-derived only, no historical stats) |
| **Matchup context** | P | Y | N | N | P (event identity only) |
| **Hit rate / historical performance** | Y | Y | N | S (volume-limited) | S (volume gate enforced) |
| **Trend filters / splits** | Y | Y | N | N | N (blocked: no historical stat table) |
| **Pick entry / submission** | Y | N [verify] | Y | Y (Smart Form) | Y |
| **Pick grading / settlement** | N | N | N | Y | Y |
| **Promotion / scoring engine** | N | N | N | Y | Y |
| **Promotion score breakdown** | N | N | N | P (pick detail only) | Y (Decision workspace) |
| **Routing preview / distribution visibility** | N | N | N | N | Y |
| **Board saturation / cap visibility** | N | N | N | N | Y |
| **ROI tracking** | P | Y | P [verify] | S (volume-limited) | S → Y (as volume grows) |
| **CLV / closing line tracking** | N | P [verify] | N | N (blocked UTV2-335) | Y (post UTV2-335) |
| **Score calibration / model feedback** | N | N | N | S (code not activated) | Y |
| **Capper leaderboard** | Y | N | N | P (existing performance page) | Y |
| **Operator review queue** | N | N | N | Y | Y |
| **Manual intervention / retry** | N | N | N | Y | Y |
| **Audit trail / lifecycle detail** | N | N | N | Y | Y |
| **Recap / summary posting** | N | N | N | Y | Y |
| **Community / social features** | Y | P | Y | N | N (reject) |
| **Gamification (badges, streaks)** | Y | N | Y | N | N (reject) |
| **Bet slip / DFS integration** | N | Y [verify] | Y | N | N (reject) |
| **Push notifications** | P | P | N | N | N (out of scope) |
| **Mobile-first UX** | Y | Y | Y | N | N (operator-first, desktop) |
| **API / data export** | N | N | N | N | N (out of scope for now) |

---

## Section 2 — Competitor Strengths (Honest Assessment)

### PropsMadness

**Strengths:**
- **Prop aggregation depth:** PropsMadness is primarily a prop aggregation layer. It collects lines from multiple books simultaneously and surfaces them in a unified browser. The multi-book line comparison (line-shopping) UX is well-executed and fast [verify].
- **Historical hit rate display:** Shows per-player, per-market hit rates over selectable time windows (last 10, last 20, season, etc.). This is the most-referenced feature by sports bettors and DFS players alike.
- **Trend and split filters:** Filters by home/away, opponent, matchup context. Operators at other shops use this to validate prop lines before submitting.
- **Consumer UX polish:** Designed for retail bettors. Intuitive, mobile-friendly. Not operator-facing — but the data richness is the differentiator.

**What PropsMadness does well that Unit Talk currently cannot:**
- External statistical context for player props (requires historical box score ingest pipeline not yet in Unit Talk DB)
- Real-time line movement display at the prop level [verify — depends on their data feed refresh rate]
- Consumer-facing prop browser with social sharing

**PropsMadness weakness:** No operator workflow. No scoring, promotion, routing, lifecycle, or audit trail. It is pure market data with no execution layer. An operator using PropsMadness still needs a separate tool to manage picks through a workflow.

---

### Outlier

**Strengths:**
- **Player projection models:** Outlier is primarily a projection-first product. It builds proprietary player projections and surfaces edge against the posted line [verify — model depth may vary by sport].
- **Projection vs. line gap:** The core UX is "here is our model's number, here is the book's line, here is the gap." This is conceptually aligned with Unit Talk's `edge` score but surfaced directly to the user.
- **Historical calibration display:** Shows how well Outlier's projections have performed historically — i.e., when Outlier projected +3.5% edge, what was the actual win rate? [verify]
- **CLV-adjacent framing:** Outlier discusses "value" against market consensus, which is functionally similar to CLV framing. They may not compute CLV directly.

**What Outlier does well that Unit Talk currently cannot:**
- Projection model output surfaced per prop (Unit Talk has model scoring but surfaces scores, not projections)
- Projection calibration history at the model level (Unit Talk's calibration module is not yet activated)
- Mobile UX for prop browsing

**Outlier weakness:** Consumer-facing tool, not operator workflow. No submission, grading, distribution, or audit trail. Operators at other shops use Outlier for research, not execution.

---

### Props Cash

**Strengths:**
- **Pick submission with tracking:** Props Cash allows users to log picks and track their own record. This is the closest consumer analog to Unit Talk's submission + grading workflow [verify — feature set may have changed].
- **Leaderboard / social proof:** Public leaderboards showing top pickers. Social accountability layer.
- **Contest / game layer:** Prop contest format — pick-em style. This is a product category Unit Talk is not targeting.
- **Multi-book line aggregation:** Similar to PropsMadness — lines from multiple books in one place [verify].

**What Props Cash does well that Unit Talk currently cannot:**
- Pick logging with result tracking (Unit Talk has this operationally but not in a consumer-facing way)
- Capper reputation / leaderboard (Unit Talk has a leaderboard endpoint but not a designed leaderboard surface)

**Props Cash weakness:** No operator workflow, no promotion/scoring engine, no distribution, no audit trail. The tracking is pick-log level, not lifecycle/delivery level. Consumer-first product with gamification that dilutes operator credibility.

---

## Section 3 — Unit Talk Differentiators

These are things Unit Talk does that none of the three competitors do:

| Differentiator | Description |
|---|---|
| **Promotion scoring engine** | Five-component weighted score (edge, trust, readiness, uniqueness, boardFit) that evaluates each pick against a configurable policy before distribution. No competitor has this. |
| **Promotion gate enforcement** | Picks that do not qualify do not reach Discord. The gate is enforced in code, not manually. No competitor enforces a programmatic quality gate between research and distribution. |
| **Pick lifecycle state machine** | `validated → queued → posted → settled` with audit log at every transition. Competitors have no lifecycle concept — picks exist as static records. |
| **Distribution outbox** | Postgres-backed outbox with claim/retry/circuit-breaker. No competitor has a delivery reliability layer. |
| **Operator-first design** | Command Center is for operators, not consumers. Decision workspace, intervention log, exception queue, held picks — these are workflow tools, not data displays. No competitor has an operator workflow layer. |
| **CLV wiring** (future) | Closing line value computed and stored per pick at settlement. No competitor computes CLV per-pick as a first-class data point. |
| **Audit trail** | Every lifecycle event, every manual intervention, every settlement is logged to `audit_log` with actor identity. No competitor has this. |
| **Scoring calibration** | Domain code exists to measure how well promotion score components predict outcomes. No competitor has feedback-loop calibration. |

---

## Section 4 — Copy List (Features to Adopt)

Mark: **adopt**

These are commodity features that bettors and operators expect. Implementing them does not dilute Unit Talk's positioning — it removes friction.

| Feature | Competitor source | Priority | Notes |
|---|---|---|---|
| **Prop line browser with multi-book comparison** | PropsMadness, Props Cash | High | Adopt for Research workspace Prop Explorer + Line-Shopper. Data already exists in `provider_offers` (329k rows). No external dependency needed. |
| **Per-pick hit rate display** | PropsMadness, Outlier | Medium | Adopt as Research workspace Hit Rate module. Volume-gated. Source: `settlement_records + picks`. |
| **Capper leaderboard (ROI-ranked)** | Props Cash | Medium | Adopt as Intelligence workspace ROI by Capper sorted view. More credible than social leaderboards because it's audit-backed. |
| **Record display (W-L-P) per capper and per market** | PropsMadness, Props Cash | High | Adopt — already partially available via `settlement_records`. Standard operator expectation. |
| **Calibration display (projection accuracy over time)** | Outlier | Low | Adopt conceptually — Unit Talk's domain code implements this. Blocked on sufficient sample size + CLV availability. |

---

## Section 5 — Reject List (Features to Decline)

Mark: **reject** with reason

These features would dilute Unit Talk's operator-first positioning or create technical or product debt that outweighs any benefit.

| Feature | Competitor source | Reason to reject |
|---|---|---|
| **Social / community features** (comments, follows, sharing) | PropsMadness, Props Cash | Dilutes operator-first positioning. Creates moderation burden. Unit Talk is not a consumer social product. **Reject.** |
| **Gamification** (badges, streaks, achievements) | PropsMadness, Props Cash | Consumer engagement mechanic. Misaligned with operator workflow. Credibility requires clean audit trail, not badges. **Reject.** |
| **Bet slip integration / DFS lineup builder** | Props Cash, Outlier | Out of scope. Execution layer is Discord distribution + smart form, not a bet slip. Adding this creates a regulatory surface. **Reject.** |
| **Consumer-facing pick feed** (public leaderboard with picks) | Props Cash | Exposing picks publicly breaks the operator model. Operators own their distribution. **Reject.** |
| **Push notifications to consumers** | PropsMadness | Consumer notification layer. Unit Talk distributes via Discord. Adding push notification infrastructure is a separate product surface with its own contracts. **Reject for now.** |
| **Mobile-first UI** | All three competitors | Command Center is an operator dashboard. Operators use desktop. Mobile-first would require significant UX investment for a surface used by 1–5 operators on desktop. **Reject as primary design target.** Responsive-friendly is acceptable. |
| **Historical external stat data** (player box scores, game logs) | PropsMadness, Outlier | Requires a historical ingest pipeline that does not exist (no `player_game_stats` table). Only pick-derived outcomes are available. Do not fake this with stubs. **Reject until pipeline exists.** |
| **Projection model display** (unit talk proprietary projections) | Outlier | Domain models exist but are not operationally calibrated. Surfacing uncalibrated projections as "Outlier does" would erode trust. Wait for calibration module to reach `high` confidence. **Reject until calibration proves reliable.** |

---

## Section 6 — Priority Order (Gap Closure by Operator Workflow Impact)

Ranked by how much closing the gap improves the daily operator workflow, not consumer appeal.

| Priority | Gap | Why it matters | Effort | Status |
|---|---|---|---|---|
| 1 | **Prop line browser (Research workspace — Prop Explorer)** | Operators currently have no in-tool way to browse available props before submitting. Must leave Command Center to check lines. Highest daily friction. | Low — data exists in `provider_offers` | Shippable now |
| 2 | **Multi-book line comparison (Line-Shopper)** | Operators need to see Pinnacle, DK, FD, BetMGM lines side-by-side to assess value. Currently must open multiple sportsbook tabs. | Low — `provider_offers.bookmaker_key` live | Shippable now |
| 3 | **ROI by capper / market / tier (Intelligence workspace)** | Operators need to know which cappers are profitable before adjusting promotion policy. Currently no in-tool ROI view. | Medium — endpoint does not exist yet | Shell (volume-limited) |
| 4 | **Score breakdown per pick (Decision workspace — Score Breakdown)** | Operators reviewing a pick need to see why it scored the way it did. Currently only accessible via pick detail raw metadata. | Low — `pick_promotion_history` live | Shippable now |
| 5 | **Record display (W-L-P) in Intelligence workspace** | Basic operator expectation. Without this, the Intelligence workspace has no baseline credibility. | Low — `settlement_records` live | Shell (low volume) |
| 6 | **Capper leaderboard (ROI-ranked)** | Operators need to know who is performing, not just who has the most picks. Current leaderboard endpoint exists but surface is not designed. | Low — endpoint exists | Shippable with ROI by capper |
| 7 | **Hit rate display (Research workspace)** | Research-time sanity check: how often has this player hit over/under this line? Requires settled picks per segment. | Medium — volume-gated | Shell |
| 8 | **CLV tracking (Intelligence workspace)** | Highest-value long-run metric. CLV predicts profitability independent of short-run variance. | High — blocked on UTV2-335 | Blocked |
| 9 | **Scoring calibration (Intelligence workspace)** | Feedback loop for promotion model improvement. Critical long-term but not daily workflow. | Medium — code exists, endpoint missing | Shell |
| 10 | **Historical stat context (Research workspace)** | Would close the biggest gap vs. PropsMadness/Outlier. But requires a pipeline that does not exist. | Very high — new ingest pipeline | Blocked indefinitely |

---

## Summary Verdict

**PropsMadness and Outlier beat Unit Talk on:** market data richness, historical context, consumer UX polish. These are research-layer features. Unit Talk can close Priority 1–2 gaps quickly because `provider_offers` is already populated.

**Props Cash beats Unit Talk on:** consumer tracking UX and social proof. Unit Talk has no interest in this category — operator-first is the correct positioning.

**Unit Talk beats all three on:** operator workflow, scoring engine, lifecycle management, distribution reliability, audit trail. These are not commodities — they are the product. None of the three competitors have a meaningful version of any of these.

**What to build next:** Prop Explorer and Line-Shopper (shippable now), then ROI/Record views in Intelligence (shell, volume-limited), then Score Breakdown in Decision workspace (shippable now). This closes the top operator friction points while staying in Unit Talk's operator-first lane.

**What not to chase:** Social features, gamification, mobile-first, consumer-facing pick feeds. These are the competitors' lane, not Unit Talk's.
