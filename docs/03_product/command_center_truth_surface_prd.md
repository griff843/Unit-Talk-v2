---
title: Command Center Truth Surface PRD
status: superseded
owner: product
last_updated: 2026-03-22
---

# Command Center Truth Surface PRD

> **SUPERSEDED 2026-03-29.** The operator-web surface is now live and is fully documented in `PLATFORM_SURFACES_AUTHORITY.md` and `COMMAND_CENTER_LIFECYCLE_MINIMUM_SPEC.md`. This PRD was a pre-M10 planning doc and no longer reflects current reality. Do not use for current-state operator surface reference.

## Document Type

- Product Requirements Document
- Status: Draft
- Scope Level: Current milestone / near-term operator truth surface

## Product Goal

Command Center must provide a truthful operator read surface for the current Unit Talk lifecycle without inventing or masking state.

It should help an operator answer:

> What is the system doing right now, and is the lifecycle completing truthfully?

## Current Milestone Objective

Define the minimum truthful Command Center / operator surface required now that recap/stats has been unblocked by a live settlement summary consumer.

## In Scope

- live operator-facing recap / settlement summary
- runtime truth visibility for current lifecycle state
- clear operator-readable representation of:
  - settlement outcomes
  - hit rate
  - flat-bet ROI
  - result distribution
- API exposure of recap summary for machine-readable use
- UI display of recap summary in operator dashboard

## Out of Scope

- speculative advanced analytics not backed by live runtime truth
- synthetic or mocked operator metrics
- long-range product vision for the full enterprise Command Center
- speculative widgets with no governed source contract

## Core Product Requirements

### R1. Truthful Recap Surface

The operator dashboard must display recap information derived from live settlement data, not manually assembled display-only logic.

### R2. API Parity

Any recap state shown in the UI must also be available through a machine-readable endpoint.

### R3. Shared Domain Logic

Recap calculations must come from shared domain logic so that all consuming surfaces agree.

### R4. No Silent Data Substitution

If recap data is unavailable, degraded, or incomplete, the surface must expose that state clearly rather than silently substituting placeholders.

### R5. Operator Utility

The operator must be able to quickly assess:

- win/loss distribution
- hit rate
- flat-bet ROI
- whether recap is present and updating from runtime data

## User Stories

- As an operator, I want to see whether settled picks are producing a truthful recap summary so I can verify lifecycle completeness.
- As an operator, I want the recap UI and API to agree so dashboards and automation can rely on the same truth.
- As an operator, I want missing or degraded recap state surfaced explicitly so I do not mistake absence for success.

## Current Delivered Capability

The following is now considered delivered for this scope:

- settlement summary is computed via shared domain logic
- summary is attached to operator snapshot state
- summary is exposed via `GET /api/operator/recap`
- summary is rendered in the operator dashboard

## Known Limitations

- Smart Form runtime hygiene remains a separate open issue and may still affect broader operational trust if stale processes are not controlled.
- This PRD only covers the current truthful recap/operator read surface, not the full future Command Center product.

## Acceptance Criteria

- Operator recap values are sourced from live settlement-derived domain logic.
- Operator dashboard and recap endpoint are materially consistent.
- Missing or degraded recap data is surfaced explicitly.
- No UI-only recap logic exists that can diverge from the shared domain source.
- Capability is covered by test evidence at appropriate layers.

## Non-Goals

This PRD does not attempt to define:

- full enterprise observability
- portfolio analytics
- advanced capper benchmarking
- strategic forecasting widgets
- monetization or subscriber-facing analytics

## Next Recommended Expansion Areas

After runtime hygiene is stabilized, the next likely expansions are:

- lifecycle state visibility beyond recap
- operator alerts for degraded or missing recap state
- tighter linkage between settlement, recap, and downstream performance surfaces
- governed truth surfaces for additional Command Center widgets
