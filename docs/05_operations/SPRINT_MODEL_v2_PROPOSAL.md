# Sprint Model v2 — Proposal

> **SUPERSEDED 2026-03-29.** This was the pre-ratification draft. The active sprint model is `docs/05_operations/SPRINT_MODEL_v2.md`.

## Problem

The weekly cadence served the project well from Weeks 6-16 when each week had a distinct integration boundary with real operational risk (live channel activations, schema migrations, settlement truth changes). Starting around Week 17, the risk profile shifted: most remaining work is pure-computation wiring or service wrapper integration with no schema changes, no live routing changes, and no settlement truth changes.

The ceremony overhead now outweighs the implementation work for typical slices:

| Activity | Time Cost | Value at Current Risk Level |
|----------|-----------|----------------------------|
| Write contract doc | Medium | Low (scope is obvious) |
| Update `status_source_of_truth.md` | Medium | Low (redundant with other files) |
| Update `current_phase.md` | Medium | Low (redundant with above) |
| Update `next_build_order.md` | Low | Medium (queue is useful) |
| Write proof/failure/rollback templates | Medium | Low (pure computation has no rollback) |
| Sync Linear | Low | Medium |
| Sync Notion | Medium | Low (usually stale anyway) |

**Evidence of drag:**
- Week 21 added 2 functions and changed 2 lines. The doc reconciliation took longer than the code.
- Weeks 18-19-21 were all "wire domain analysis deeper into promotion scoring" — that's one logical unit split into three ceremony cycles.
- Week 20 was a validation-only week with zero code changes but full ceremony.

## Proposed Model

### 1. Replace Weekly Cadence with Risk-Tiered Sprints

Every sprint is classified at planning time into one of three tiers:

| Tier | When | Ceremony | Examples |
|------|------|----------|----------|
| **T1 — High Risk** | Schema migrations, live routing changes, settlement truth changes, new external integrations | Full: contract + proof bundle + independent verification + rollback plan | Week 7 (best-bets activation), Week 8 (settlement schema), Week 11B (trader-insights live) |
| **T2 — Medium Risk** | New service wrappers, cross-package integration, new test infrastructure | Light: scope section in sprint commit message + test evidence + status update | Week 18 (domain integration layer), Offer Fetch wrapper |
| **T3 — Low Risk** | Pure-computation wiring, score enrichment, additional test coverage, doc cleanup | Minimal: descriptive commit message + test count delta | Week 19 (edge fallback), Week 21 (trust/readiness) |

**Tier determines ceremony, not cadence.** A T1 sprint might take a week. A T3 sprint might take 30 minutes. Three T3 sprints can be batched into one commit.

### 2. Consolidate Status Files

**Current: 4 overlapping files that all need the same updates**
- `status_source_of_truth.md` — program state, week status, routing, risks, capabilities
- `current_phase.md` — same program state + completed work list + authority links
- `next_build_order.md` — completed items + next candidates
- `system_snapshot.md` — runtime evidence

**Proposed: 2 files with distinct responsibilities**

| File | Purpose | Updated When |
|------|---------|-------------|
| `PROGRAM_STATUS.md` | Single source of truth. Current state, week/sprint log, live routing, risks, authority links. Replaces `status_source_of_truth.md` + `current_phase.md` + `next_build_order.md`. | Every sprint close |
| `system_snapshot.md` | Runtime evidence only. DB state, live proofs, health checks. | Only when runtime state changes (T1/T2 sprints) |

This cuts the per-sprint doc update from 3 files to 1.

### 3. Drop Per-Week Template Files

**Current:** 23 per-week proof/failure/rollback/closeout template files in `docs/06_status/`.

**Proposed:** No more per-week template files. Instead:
- **T1 sprints** use a single reusable `docs/06_status/PROOF_TEMPLATE.md` and `docs/06_status/ROLLBACK_TEMPLATE.md`
- **T2 sprints** document test evidence in the commit message or a brief note
- **T3 sprints** need no templates — the test count delta in the commit is the proof

The 23 existing template files become historical artifacts. Don't delete them (they document what happened), but don't create new ones.

### 4. Batch Related Work

Instead of one contract per logical slice, group related slices into milestone-scoped sprints:

**Example — what Weeks 18-21 would look like under this model:**

| Old Model | New Model |
|-----------|-----------|
| Week 18: Domain Integration Layer (contract + 3 status updates + proof template) | **Sprint: Domain Analysis Integration (T2)** |
| Week 19: Promotion Edge Integration (contract + 3 status updates + proof template) | All four slices in one sprint. |
| Week 20: E2E Validation (contract + 3 status updates) | One commit per logical boundary. |
| Week 21: Promotion Scoring Enrichment (contract + 3 status updates) | One status update at sprint close. |
| **Ceremony: 4 contracts + 12 status updates + 3 templates** | **Ceremony: 1 status update** |

### 5. Keep the Safety Guardrails That Matter

These are non-negotiable regardless of tier:
- `pnpm verify` (type-check + lint + build + test) must pass before every commit
- Single-writer gate remains enforced
- Test count must not decrease
- Live routing changes always require T1 ceremony
- Schema migrations always require T1 ceremony

### 6. Simplified Sync Protocol

| Surface | When to Sync |
|---------|-------------|
| Git (commit + push) | Every sprint close |
| `PROGRAM_STATUS.md` | Every sprint close |
| Linear | T1 and T2 sprint closes only. T3 sprints batch into the next T2 sync. |
| Notion | Monthly or at major milestones. Not per-sprint. |

## Remaining Work Under New Model

| Sprint | Tier | Scope | Why This Tier |
|--------|------|-------|---------------|
| Offer Fetch Service Wrapper | T2 | New service file + submission integration + tests | New cross-package integration |
| DeviggingService Integration | T2 | Multi-book consensus at submission | New service wrapper with external data dependency |
| Risk Engine Integration | T2 | Bankroll-aware sizing beyond Kelly | New service wrapper |
| Observation Hub Permanent | T2 | Promote R7 observation into permanent subsystem | Architectural change |
| Promotion uniqueness/boardFit enrichment | T3 | Wire remaining static defaults to domain signals | Pure computation, same pattern as Week 21 |
| Channel expansion (game-threads, strategy-room) | T1 | New live Discord routing | Live routing = always T1 |

## Migration Path

1. Write `PROGRAM_STATUS.md` by merging the three current status files (one-time, ~30 min)
2. Add a deprecation note to the top of `status_source_of_truth.md`, `current_phase.md`, and `next_build_order.md` pointing to `PROGRAM_STATUS.md`
3. Write reusable `PROOF_TEMPLATE.md` and `ROLLBACK_TEMPLATE.md` (one-time, ~10 min)
4. Next sprint uses the new model
5. Existing per-week contract and template files remain as historical record

## What This Does NOT Change

- The sprint naming convention (still `SPRINT-<NAME>`)
- The git commit discipline (still atomic, still descriptive)
- The test and gate requirements (still mandatory)
- The single-writer enforcement (still strict)
- The Linear issue tracking (still the execution mirror)
- The "Do Not Start Without Planning" list (still blocked)

## Decision

This proposal is ready for operator review. If approved, I'll execute the migration in one bounded sprint.
