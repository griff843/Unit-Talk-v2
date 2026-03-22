# Salvaged Domain Runtime Consumption Plan

## Purpose

This document maps the already-salvaged domain modules to the runtime surfaces that should consume them next.

It is factual and execution-oriented. It does not claim active wiring that does not exist.

## Current Consumption Summary

| Module family | Current runtime consumer(s) | Current state | Best next consumer |
|---|---|---|---|
| probability | `apps/api/src/domain-analysis-service.ts` | Active | submission scoring and consensus wrappers |
| outcomes | `apps/api/src/settlement-service.ts`, `apps/operator-web/src/server.ts` | Active | recap/reporting surfaces |
| risk | `apps/api/src/domain-analysis-service.ts`, `apps/api/src/promotion-service.ts` | Partially active | operator sizing display, richer promotion/readiness logic |
| bands | none in app runtime | Not consuming | promotion classification and operator explanations |
| scoring | none in app runtime | Not consuming | submission scoring / promotion inputs |
| features | none in app runtime | Not consuming | submission analysis pipeline |
| models | none in app runtime | Not consuming | submission analysis pipeline |
| signals | none in app runtime | Not consuming | submission analysis and distribution timing |
| market | none in app runtime beyond promotion/distribution concepts | Not consuming | post-distribution monitoring and evaluation |
| calibration | none in app runtime | Not consuming | recap, health, and operator calibration views |
| evaluation | none in app runtime | Not consuming | settlement analytics and recap |
| edge-validation | none in app runtime | Not consuming | submission validation and post-pick review |
| rollups | none in app runtime | Not consuming | recap and command-center summaries |
| system-health | none in app runtime | Not consuming | operator command center |
| strategy | none in app runtime | Not consuming | offline analysis / lab / future recap comparison surfaces |

## What Is Already Live

### probability

- Active consumer:
  - `apps/api/src/domain-analysis-service.ts`
- Current usage:
  - implied probability
  - decimal odds conversion
  - edge
  - Kelly fraction

### outcomes

- Active consumers:
  - `apps/api/src/settlement-service.ts`
  - `apps/operator-web/src/server.ts`
- Current usage:
  - effective settlement resolution
  - settlement summary
  - loss attribution
  - corrected settlement view in operator read model

### risk

- Active consumers:
  - `apps/api/src/domain-analysis-service.ts`
  - `apps/api/src/promotion-service.ts`
- Current usage:
  - Kelly fraction in submission-time analysis
  - readiness signal fallback in promotion scoring

## Highest-Value Next Runtime Consumers

### Batch family 1 - Submission intelligence

Goal: make the pick materially smarter before it is ever distributed.

Best module families:
- `features`
- `models`
- `signals`
- `scoring`
- `bands`
- `edge-validation`

Best runtime surface:
- `apps/api/src/submission-service.ts`
- supporting services adjacent to:
  - `apps/api/src/domain-analysis-service.ts`
  - `apps/api/src/promotion-service.ts`

Why first:
- this is the most direct path to improving pick quality
- it turns salvage into live decision quality instead of dormant package depth

Suggested consumption order:
1. `scoring`
2. `bands`
3. selected `features`
4. selected `models`
5. selected `signals`
6. `edge-validation`

### Batch family 2 - Settlement analytics

Goal: make settlement produce more than terminal state.

Best module families:
- `evaluation`
- `rollups`
- `baseline-roi`
- selected `calibration`

Best runtime surface:
- `apps/api/src/settlement-service.ts`
- recap/reporting follow-on surface

Why next:
- settlement is where truth becomes measurable performance
- this is the bridge from lifecycle correctness to operating intelligence

### Batch family 3 - Command center expansion

Goal: turn operator-web from monitoring surface into a true command center.

Best module families:
- `rollups`
- `system-health`
- `evaluation`
- `calibration`
- selected downstream summaries from `outcomes`

Best runtime surface:
- `apps/operator-web/src/server.ts`

Why next:
- command center is the right read-facing home for recap/stat visibility
- it provides the operating proof surface for production readiness

## Module-by-Module Runtime Plan

### bands

- Current app consumer: none
- Best first use:
  - compute and persist a band classification alongside submission-time analysis
  - expose the band in promotion reasoning and operator views
- Why it matters:
  - gives operators a compact pick-quality language instead of only raw scores

### scoring

- Current app consumer: none
- Best first use:
  - normalize sport-specific scoring inputs during submission/promotion evaluation
- Why it matters:
  - replaces generic fallbacks with controlled sport-aware weighting

### features

- Current app consumer: none
- Best first use:
  - enrich submission-time analysis for player-prop and game-context picks
- Why it matters:
  - creates a bridge from raw input to model-ready signal construction

### models

- Current app consumer: none
- Best first use:
  - generate forecast/blend outputs that feed scoring, edge, and confidence reasoning
- Why it matters:
  - this is the deepest source of salvage value still sitting idle

### signals

- Current app consumer: none
- Best first use:
  - market-vs-model signal quality and timing relevance
- Why it matters:
  - can improve both promotion quality and future post-distribution monitoring

### market

- Current app consumer: none
- Best first use:
  - post-distribution market reaction summaries
  - later feed into evaluation and operator drift visibility
- Why it matters:
  - connects live market response to pick quality and performance review

### calibration

- Current app consumer: none
- Best first use:
  - operator calibration section
  - recap/report surface
- Why it matters:
  - helps prove whether confidence and model quality are trustworthy over time

### evaluation

- Current app consumer: none
- Best first use:
  - post-settlement performance scoring
  - recap output
- Why it matters:
  - converts win/loss history into quality signals that can drive decision changes

### edge-validation

- Current app consumer: none
- Best first use:
  - submission-time sanity checks
  - review-facing support in operator surfaces
- Why it matters:
  - gives the runtime a way to question weak picks instead of only scoring them

### rollups

- Current app consumer: none
- Best first use:
  - daily and session summaries after settlement
  - command-center and recap views
- Why it matters:
  - this is the natural runtime layer for recap generation

### system-health

- Current app consumer: none
- Best first use:
  - operator command center
- Why it matters:
  - the command center needs a formal health model, not only raw recent rows

### strategy

- Current app consumer: none
- Best first use:
  - offline replay/lab surface, not the live write path
- Why it matters:
  - valuable, but lower priority than submission/settlement/operator consumption

## Recommended Batch Order

### Batch A - Runtime scoring and classification

- `scoring`
- `bands`
- selected `features`
- selected `models`

Primary surface:
- submission + promotion

### Batch B - Market-aware quality and validation

- `signals`
- `market`
- `edge-validation`

Primary surface:
- submission review + promotion + later operator insight

### Batch C - Settlement analytics and recap

- `evaluation`
- `rollups`
- `baseline-roi`
- selected `calibration`

Primary surface:
- settlement + recap

### Batch D - Command center intelligence

- `system-health`
- `rollups`
- `evaluation`
- `calibration`

Primary surface:
- operator-web command center

### Batch E - Strategy / lab follow-on

- `strategy`
- richer `risk`

Primary surface:
- offline analysis and future planning tools

## What Not To Do

- Do not attempt to wire every salvaged domain family at once
- Do not create a second write path outside the API
- Do not put deep strategy or recap logic into Smart Form
- Do not claim command-center completeness before `rollups`, `evaluation`, and `system-health` have real app consumers

## Practical Next Move

The highest-leverage next consumption work after gate hardening is:

1. finish deterministic root verify
2. execute one bounded full-cycle runtime proof
3. wire settlement analytics + command-center recap surfaces
4. deepen submission intelligence using scoring, bands, and selected model/features work

That order gets the platform to stronger production truth faster than broad salvage wiring without proof.
