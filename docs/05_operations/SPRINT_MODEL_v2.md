# Sprint Model v2 — Risk-Tiered Sprints

> Adopted 2026-03-21. Replaces the weekly ceremony model used for Weeks 6-21.
> Decision record: `docs/05_operations/SPRINT_MODEL_v2_PROPOSAL.md`

## Core Principle

Sprint ceremony scales with risk. High-risk changes get full governance. Low-risk changes get a clean commit and passing tests.

## Sprint Tiers

### T1 — High Risk

**When:** Schema migrations, live routing changes, settlement truth changes, new external integrations, anything that touches production data or live user-facing behavior.

| Requirement | Detail |
|-------------|--------|
| Contract | Required. Written before implementation begins. |
| Proof bundle | Required. Captured command outputs in `out/sprints/` or inline. |
| Independent verification | Required. At least one verification pass after implementation. |
| Rollback plan | Required. Documented before activation. |
| Status update | Update `PROGRAM_STATUS.md`. |
| Linear sync | Required at sprint close. |
| Notion sync | Required at sprint close. |
| Test evidence | `pnpm verify` must pass. Test count must not decrease. |

**Examples:** Week 7 (best-bets activation), Week 8 (settlement schema), Week 11B (trader-insights live), future channel activations.

### T2 — Medium Risk

**When:** New service wrappers, cross-package integration, new test infrastructure, architectural changes to existing subsystems.

| Requirement | Detail |
|-------------|--------|
| Contract | Optional. Scope documented in commit message or brief inline note if no contract. |
| Proof bundle | Not required. Test results in commit suffice. |
| Independent verification | Not required. `pnpm verify` passing is sufficient. |
| Rollback plan | Not required (code is revertable via git). |
| Status update | Update `ISSUE_QUEUE.md` (DONE) + update `PROGRAM_STATUS.md` capabilities/risks if behavior changed. |
| Linear sync | Required at sprint close. |
| Notion sync | Batched — sync at next T1 close or monthly. |
| Test evidence | `pnpm verify` must pass. Test count must not decrease. |

**Examples:** Week 18 (domain integration layer), Offer Fetch wrapper, Observation Hub promotion.

### T3 — Low Risk

**When:** Pure-computation wiring, score enrichment, additional test coverage, doc cleanup, refactoring with no behavioral change.

| Requirement | Detail |
|-------------|--------|
| Contract | Not required. |
| Proof bundle | Not required. |
| Independent verification | Not required. |
| Rollback plan | Not required. |
| Status update | Update `ISSUE_QUEUE.md` (DONE). No `PROGRAM_STATUS.md` update required. |
| Linear sync | Batched — sync at next T2+ close. |
| Notion sync | Batched — sync at next T1 close or monthly. |
| Test evidence | `pnpm verify` must pass. Test count must not decrease. |

**Examples:** Week 19 (edge fallback), Week 21 (trust/readiness enrichment), additional test coverage sprints.

**Batching:** Multiple T3 sprints can be grouped into a single commit if they're logically related.

**Structural refactor rule:** Pure structural refactors (no behavior change, no schema change, no routing change) qualify for T3 ceremony regardless of how the issue is tier-labeled in the queue. If an issue is labeled T2 but meets the T3 criteria above, T3 ceremony is correct. Reclassify at implementation time and note in the commit.

## What Remains Unchanged

These are non-negotiable regardless of tier:

- `pnpm verify` (type-check + lint + build + test) must pass before every commit
- Single-writer discipline enforced via `lifecycle:single-writer -- --strict`
- Test count must not decrease
- Commits must be atomic and descriptive
- Sprint naming convention: `SPRINT-<NAME>`
- Git commit quality standards
- `discord:canary` remains permanently active
- "Do Not Start Without Planning" list remains enforced

## Status Authority

| File | Purpose | Updated When |
|------|---------|-------------|
| `docs/06_status/ISSUE_QUEUE.md` | Operational work queue — active/ready/blocked/done | Every lane state change |
| `docs/06_status/PROGRAM_STATUS.md` | High-level program status — milestone, capabilities, risks | T1/T2 sprint close only |
| `docs/06_status/system_snapshot.md` | Runtime evidence record — IDs, receipts, proof | When new T1 proof is captured |

The following files are superseded (historical record only):
- `docs/06_status/status_source_of_truth.md`
- `docs/06_status/current_phase.md`
- `docs/06_status/next_build_order.md`

## Proof and Rollback Templates

Reusable templates replace per-week template creation:
- `docs/06_status/PROOF_TEMPLATE.md` — used for T1 sprints
- `docs/06_status/ROLLBACK_TEMPLATE.md` — used for T1 sprints

Existing per-week template files (Weeks 7-16) are preserved as historical record.

## Tier Classification

The sprint author classifies the tier at planning time. If uncertain, default to the higher tier. The classification can be adjusted during implementation if risk is discovered to be higher or lower than expected.

**Automatic T1 triggers:**
- Any `supabase/migrations/` file created or modified
- Any change to live routing targets (`discord:best-bets`, `discord:trader-insights`)
- Any change to settlement write path (`lifecycleSettle`, `recordPickSettlement`)
- Any change to `PROGRAM_STATUS.md` routing state table

## Sync Cadence Summary

| Surface | T1 | T2 | T3 |
|---------|-----|-----|-----|
| Git commit + push | Yes | Yes | Yes |
| `ISSUE_QUEUE.md` | Mark DONE | Mark DONE | Mark DONE |
| `PROGRAM_STATUS.md` | Full update (capabilities, risks, milestone) | Update capabilities/risks if changed | No update required |
| Linear | Sync at close | Sync at close | Batch into next T2+ |
| Notion | Sync at close | Batch into next T1 or monthly | Batch into next T1 or monthly |
