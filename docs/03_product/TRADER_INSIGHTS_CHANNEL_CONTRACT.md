# Trader Insights Channel Contract

## Metadata

| Field | Value |
|-------|-------|
| Status | Ratified |
| Ratified | 2026-03-29 |
| Issue | UTV2-159 |
| Channel ID | `1356613995175481405` |
| Target key | `discord:trader-insights` |
| Live since | Week 11 (2026-03-21) |

---

## Purpose

`Trader Insights` is Unit Talk's sharp-money and edge-intelligence channel.

It serves members who want to understand market structure and directional conviction — not just the top plays, but the reasoning, edge quality, and market context behind them.

Where Best Bets is an execution board (take it or leave it), Trader Insights is an intelligence board (understand why the signal is strong).

---

## Trader Room Relationship

Within the Trader Room concept:

- **Best Bets** = execution board — highest-conviction plays, minimal explanation needed
- **Trader Insights** = edge and market-context board — strong-edge plays with implicit market intelligence
- **Strategy Lab** = deeper research and pattern board (future)
- **Cappers Space** = broader capper ecosystem

Trader Insights sits above Best Bets in selectivity. Not every Best Bets-eligible play belongs in Trader Insights. The bar is sharper: stronger edge, higher trust, tighter alignment with market direction.

---

## Access

Trader Insights is a **VIP+ surface**.

It is not included in the standard VIP tier. The additional tier requirement is intentional: this channel carries more intelligence density and is designed for members who will act on edge signals, not just pick outcomes.

---

## What Trader Insights Is

Trader Insights is:
- an edge and market-intelligence feed
- a signal layer above Best Bets in precision and selectivity
- the primary high-trust, high-edge execution surface for active traders
- intentionally lower volume than Best Bets (the bar is higher)

Trader Insights is not:
- a duplicate of Best Bets with a different label
- a general picks feed
- a research dump or long-form analysis channel
- a capper activity stream
- a catch-all VIP+ premium channel
- a channel for "approved but not quite Best Bets" picks

---

## Promotion Threshold

A pick reaches Trader Insights only when it clears the `traderInsightsPromotionPolicy`:

| Component | Minimum |
|-----------|---------|
| Overall score | 80.00 |
| Edge | 85 |
| Trust | 85 |
| Readiness | (policy default) |
| Uniqueness | (policy default) |
| Board fit | (policy default) |

Policy version: `trader-insights-v1`.

These thresholds are deliberately strict. A pick that qualifies on score alone (≥80) but has weak edge or trust does not belong here. Both edge and trust must confirm.

---

## Priority Routing

When a pick qualifies for multiple targets, priority order wins:

1. `exclusive-insights` (when activated) — highest tier
2. `trader-insights` — this channel
3. `best-bets` — base premium tier

A pick qualifying for both trader-insights and best-bets routes **only to trader-insights**. It does not appear in both channels. This priority routing is runtime-enforced.

---

## Allowed Content

A play may be delivered to Trader Insights only if it has:
- cleared the `traderInsightsPromotionPolicy` (min score 80, edge ≥ 85, trust ≥ 85)
- been approved through the canonical pipeline
- strong edge signal — mathematical, confidence, or domain-analysis-derived
- high trust signal — capper track record or strong domain trust indicator

---

## Prohibited Content

Do not use Trader Insights for:
- plays that only clear best-bets threshold (score 70–79)
- plays with weak edge or low trust, even if overall score is ≥ 80
- raw capper submissions without evaluation
- canary test traffic
- recaps, commentary, or thread chatter
- experimental or shadow-only outputs
- debug or validation traffic

---

## Posting Philosophy

Trader Insights follows:
- precision over volume
- edge conviction over play count
- market alignment over submission quantity

Every post should feel:
- analytically grounded
- high edge, high trust
- worth acting on by a sharp-money member

If the lane starts to fill with volume-driven posts rather than high-edge signals, the channel has drifted from its purpose.

---

## Volume Rule

Trader Insights must remain more selective than Best Bets.

Best Bets may see moderate volume on active slates. Trader Insights should see fewer posts — the constraints are tighter and the audience is sharper.

If Trader Insights is posting at the same rate as Best Bets, check the policy thresholds. Either edge/trust scoring is too permissive or the submission pool is unusually strong.

---

## Operating Test

Before a pick reaches Trader Insights, ask:

> "Does this pick carry a genuinely strong edge signal with high trust, or does it merely pass a score threshold?"

Clearing the numeric threshold is necessary but not sufficient for intent alignment. The numeric policy enforces the floor. The operating test is the spirit.
