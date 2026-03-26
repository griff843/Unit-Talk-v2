---
title: T1 Recap/Stats Consumer Buildout Closeout
status: closed
owner: architecture
last_updated: 2026-03-22
---

# Milestone Closeout - T1 Recap/Stats Consumer Buildout

## Status

- CLOSED
- Verdict: `RECAP_STAGE_UNBLOCKED`
- Commit: `ba1760d`
- Verification: `534/534` tests passing, `pnpm verify = 0`

## Purpose

This document records the closeout of the T1 milestone that unblocked the recap/stats stage by introducing a truthful runtime consumer for settlement recap data and exposing it through operator-facing surfaces.

## Problem Statement

Before this milestone, the system could complete submission, posting, and settlement flows, but recap/stats remained blocked because there was no live runtime consumer that converted settlement results into an operator-readable recap surface. As a result, full-cycle proof was incomplete.

## What Was Built

- Added `resolveAllEffectiveSettlements()` to extract `EffectiveSettlement[]` from `SettlementRecord[]`
- Refactored `buildEffectiveSettlementResultMap()` to delegate to the shared helper
- Wired `computeSettlementSummary()` from `@unit-talk/domain` into snapshot generation
- Added `recap: SettlementSummary` to `OperatorSnapshot`
- Added `GET /api/operator/recap` for live settlement summary JSON
- Added a `Settlement Recap` section to the operator dashboard showing:
  - hit rate %
  - flat-bet ROI %
  - result distribution
- Added tests for:
  - unit computation
  - HTTP endpoint
  - HTML render

## Architectural Significance

This milestone resolves the recap-stage blocker the correct way:

- recap logic now lives in a shared domain consumer rather than UI-only formatting
- operator surfaces now read truthful runtime-derived recap data
- recap capability is exposed in both machine-readable and human-readable forms

## Acceptance Criteria Met

- a live settlement summary is computed from runtime settlement data
- the summary is exposed through an operator API surface
- the operator dashboard renders the recap output
- tests cover domain, transport, and render layers
- repository verification passes cleanly

## Remaining Known Deviation

Not part of this milestone's functional blocker:

- Smart Form zombie process on port `4100` remains an open runtime hygiene issue
- This does not invalidate the recap-stage unblock, but it remains an operations-truth defect that must be addressed separately

## Explicit Closeout Decision

This milestone is ratified as closed for Stage 1 recap/stats unblock purposes.

## Follow-On Work

- Resolve stale runtime/process hygiene around port `4100`
- Add deploy/restart discipline so proof environments cannot be polluted by old processes
- Continue operator surface hardening only against truthful runtime sources
