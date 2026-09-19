# Command Center Unification — Tier Classification

**Issue:** UTV2-429
**Generated:** 2026-04-07
**Authority:** This document gates T1 work in the Command Center Unification epic. No T1 slice may proceed to implementation without PM approval.

---

## T1 Trigger Checklist (for CC Unification work)

A CC Unification slice is **T1** if it involves ANY of the following:

| Trigger | Example |
|---------|---------|
| DB migration required | New tables, columns, FKs, indexes |
| New write-path in `apps/api` | New POST/PATCH endpoints that write to Supabase |
| New delivery adapter or Discord channel | New `discord:*` target |
| Changes to pick lifecycle state machine | Adding new states, transitions, or voiding rules |
| Changes to canonical routing/distribution logic | Modifying `distribution-service.ts` gating rules |
| New external integrations | New provider feeds, OAuth flows, webhooks |
| Changes to `@unit-talk/contracts` | Adding/modifying shared types consumed by multiple apps |

**If none of these triggers apply:** classify as T2 or T3.

---

## T2 Classification Criteria

A slice is **T2** if:
- It modifies existing apps, packages, or routes without triggering T1 conditions
- It adds new read-only API endpoints to operator-web or command-center
- It creates new pages/components in command-center or operator-web (read-only)
- It changes architectural layout, navigation, or workspace framing
- It changes scoring/promotion display (display layer only — never scoring logic)
- It produces specification or architecture docs that will gate implementation
- Merge requires: review diff → verify CI green → merge

## T3 Classification Criteria

A slice is **T3** if:
- UI-only changes: styling, naming, layout, visual design
- Documentation or naming normalization (no runtime surface changed)
- Navigation shell changes with no new routes
- Standard component templates (CSS patterns, design system)
- Competitive research or benchmarking docs
- Linear governance / board structure
- Merge requires: CI green → merge

---

## Issue-by-Issue Classification

### Phase 1 — Plan & Ratify

| Issue | Title | Tier | Rationale |
|-------|-------|------|-----------|
| UTV2-411 | Ratify Command Center IA | **T2** | Architecture doc — gates implementation. No runtime change. |
| UTV2-412 | Audit current Command Center | **T3** | Read-only audit doc. ✅ Done. |
| UTV2-414 | Define Research workspace MVP | **T2** | Spec doc — gates Research implementation. No runtime change. |
| UTV2-417 | Define Decision workspace MVP | **T2** | Spec doc — gates Decision implementation. No runtime change. |
| UTV2-424 | Map provider ingestion dependencies | **T3** | Analysis doc only. ✅ Done. |

### Phase 2 — Product Shell

| Issue | Title | Tier | Rationale |
|-------|-------|------|-----------|
| UTV2-413 | Normalize product language | **T3** | Docs and naming only. No code. |
| UTV2-420 | Reframe operator-web as Operations workspace | **T2** | Route/navigation changes in existing apps. No migration, no write path. |
| UTV2-421 | Unified pick detail page | **T2** | New read-only page in command-center. No write path. |
| UTV2-427 | Redesign CC navigation | **T2** | UI/nav changes in command-center. No new routes that write. |

### Phase 3 — First Modules

| Issue | Title | Tier | Rationale |
|-------|-------|------|-----------|
| UTV2-415 | Player research + matchup data model requirements | **T2/T1-flag** | If spec leads to new DB tables (player_stats, historical_stats) → T1. Spec itself is T2. |
| UTV2-416 | Benchmark competitor prop tools | **T3** | Research doc. No code. |
| UTV2-418 | Ratify scoring explanation contract | **T2** | Contract doc for how scoring is displayed. No scoring logic change. |
| UTV2-425 | Sequence analytics dashboard rebuild | **T2/T1-flag** | If sequencing requires new materialized views or tables → T1. Sequencing doc itself is T2. |

### Phase 4 — Intelligence + Overlays

| Issue | Title | Tier | Rationale |
|-------|-------|------|-----------|
| UTV2-419 | Advanced decision overlays | **T2/T1-flag** | Middling overlay requires multi-book data → if new tables needed → T1. Display spec is T2. |
| UTV2-422 | Define Intelligence workspace MVP | **T2** | Spec doc. No implementation. |
| UTV2-423 | Define source-of-truth ownership for intelligence metrics | **T2** | Governance doc. No schema changes in scope. |
| UTV2-426 | Define LLM analysis role in CC | **T2** | Contract doc. No LLM integration in scope. |
| UTV2-428 | Standardize module patterns | **T2** | Component templates in command-center. No migration, no write path. |

### Governance

| Issue | Title | Tier | Rationale |
|-------|-------|------|-----------|
| UTV2-429 | Tier classification (this issue) | **T2** | Governance doc. Gates T1 identification. |
| UTV2-430 | Governed roadmap board | **T3** | Linear governance only. |

---

## T1 Issues in This Epic

**None confirmed at spec stage.** However, the following issues carry conditional T1 risk:

| Issue | T1 Risk Condition |
|-------|-------------------|
| UTV2-415 | If player research requires new DB tables (player_stats, historical_stats) |
| UTV2-419 | If middling overlays require new DB tables for multi-book simultaneous line capture |
| UTV2-425 | If analytics rebuild requires new materialized views or aggregation tables |

**Rule:** When any T2/T1-flag issue reaches implementation and the implementer determines a migration is required, it must be escalated to T1 and PM approval obtained before proceeding.

---

## Slices Explicitly Outside T1 for This Epic

The following are NOT T1 triggers in the CC Unification context:
- Adding new read-only API endpoints to `apps/operator-web` or `apps/command-center`
- Adding new pages/routes to `apps/command-center` that only read from existing APIs
- Changing navigation structure (workspace switcher, sidebar)
- Renaming internal labels, routes, or component names
- Creating new React components or design system patterns
- Producing specs, IA docs, or audit docs

---

## Merge Policy Reference

| Tier | Policy |
|------|--------|
| T1 | Do not merge without explicit PM approval. Create PR, flag in Linear, stop. |
| T2 | Review diff → verify CI green → merge |
| T3 | CI green → merge |
