# Diff summary: WORK-2026101604

Implementation source SHA: `35aeb09ef96e912ca4ff7cfb317c576ec8d0c97a`

| File | Change |
|---|---|
| `apps/api/src/grading-service.ts` | Replaces nearest-start-time event selection with sport-scoped identity resolution. Explicit `metadata.eventId` must identify one eligible candidate; otherwise exact normalized `metadata.eventName` must identify one; without either field there must be exactly one eligible candidate. Mismatch and ambiguity fail closed. The separate 36-hour provenance rejection and its hour constant were removed. |
| `apps/api/src/grading-service.ts` | Adds distinct `identity_skipped_count` observability without adding identity failures to `DATA_DEPENDENT_SKIP_REASONS`, preserving stale-input health semantics. |
| `apps/api/src/grading-service.ts` | Adds bounded per-pick skip evidence to the existing `grading.run` `system_runs.details` JSON. |
| `apps/api/src/grading-service.test.ts` | Adds identity, cross-sport, ambiguity, time-independence, null-event, stale-health, evidence-bound, and truncation regressions; updates earlier time-selection expectations to the identity-first contract. |

## Operator skip evidence

An operator reads the new evidence on the existing grading run record at `system_runs.details.skipped_picks`. Each entry is `{pick_id, reason}` and `reason` is normalized exactly like the existing `skipped_reasons` histogram. `identity_skipped_count` makes identity failures visibly separate from `data_dependent_skipped_count`.

The list is capped at **100 entries** per run. `system_runs.details.skipped_picks_truncated_count` records how many additional skipped picks were omitted. When that count is greater than zero, `skipped_picks` is explicitly not full history; the unchanged `skipped_count` and `skipped_reasons` counters still cover the complete run.

The initial fail-closed run row contains an empty list and zero truncation. Evidence is replaced with measured per-pick entries only when `completeRun` succeeds. If run completion fails, `runGradingPass` propagates the persistence failure rather than reporting unpersisted evidence as successful. Truncation is deterministic input order: the first 100 skipped picks are retained and the exact overflow count is recorded.

## Guard mutation checks

- A mutant that selected the first candidate before evaluating identity made three targeted tests fail: wrong explicit id, far-but-correct exact name, and multiple unnamed candidates.
- A mutant that removed the sport predicate made the cross-sport same-name regression fail.
- A mutant that changed the cap comparison from `< 100` to `<= 100` made the bounded-evidence regression fail with 101 persisted entries.
- Each mutant was removed with `apply_patch`; the restored full focused file then passed 112/112.

## Explicitly untouched

Manual operator settlement, Track Only delivery containment, CLV computation, provider ingestion, settlement writing, Discord delivery, kill switches, migrations, and database types/repositories were not changed.

## SHA Binding

Merge SHA: pending merge (`null` in `evidence.json`)
PR: pending at artifact creation
