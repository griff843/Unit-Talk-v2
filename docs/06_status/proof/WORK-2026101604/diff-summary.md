# Diff summary: WORK-2026101604

Implementation source SHA: `a22bfd76fb2101fa40adfb88f9bd411d3550eb81`

| File | Change |
|---|---|
| `apps/api/src/grading-service.ts` | Replaces nearest-start-time event selection with sport-scoped identity resolution. Explicit `metadata.eventId` must identify one eligible candidate; otherwise exact normalized `metadata.eventName` must identify one; without either field there must be exactly one eligible candidate. Mismatch and ambiguity fail closed. The separate 36-hour provenance rejection and its hour constant were removed. |
| `apps/api/src/grading-service.ts` | Adds distinct `identity_skipped_count` observability without adding identity failures to `DATA_DEPENDENT_SKIP_REASONS`, preserving stale-input health semantics. |
| `apps/api/src/grading-service.ts` | Adds bounded per-pick skip evidence to the existing `grading.run` `system_runs.details` JSON. |
| `apps/api/src/grading-service.ts` | Preserves `event_link_not_found` whenever a participant has zero eligible same-sport linked events, even when the pick also carries an event id or name. Identity mismatch reasons now mean that an eligible candidate set existed but the supplied identity conflicted with it. |
| `apps/api/src/grading-service.ts` | Hardens the participant-forbidden `game_total` path without inventing participant linkage. Its authorized equivalent is the canonical event identity already persisted by submission/board flows: `metadata.eventId`, exact normalized event name when present (including the existing thesis-derived name fallback), and pick/event sport equality. An explicit id must resolve within that same-sport exact-name set; wrong, cross-sport, or name-conflicting ids fail closed. |
| `apps/api/src/grading-service.test.ts` | Adds identity, cross-sport, ambiguity, time-independence, null-event, stale-health, evidence-bound, and truncation regressions; updates earlier time-selection expectations to the identity-first contract. |
| `apps/api/src/grading-service.test.ts` | Adds review regressions for named/explicit-id picks with no eligible links, null-event WNBA/NCAAF missing-link behavior, and game-total wrong-id, cross-sport-id, conflicting-name/id, and accepted canonical-identity behavior. |

## Operator skip evidence

An operator reads the new evidence on the existing grading run record at `system_runs.details.skipped_picks`. Each entry is `{pick_id, reason}` and `reason` is normalized exactly like the existing `skipped_reasons` histogram. `identity_skipped_count` makes identity failures visibly separate from `data_dependent_skipped_count`.

The list is capped at **100 entries** per run. `system_runs.details.skipped_picks_truncated_count` records how many additional skipped picks were omitted. When that count is greater than zero, `skipped_picks` is explicitly not full history; the unchanged `skipped_count` and `skipped_reasons` counters still cover the complete run.

The initial fail-closed run row contains an empty list and zero truncation. Evidence is replaced with measured per-pick entries only when `completeRun` succeeds. If run completion fails, `runGradingPass` propagates the persistence failure rather than reporting unpersisted evidence as successful. Truncation is deterministic input order: the first 100 skipped picks are retained and the exact overflow count is recorded.

## Guard mutation checks

- A mutant that selected the first candidate before evaluating identity made three targeted tests fail: wrong explicit id, far-but-correct exact name, and multiple unnamed candidates.
- A mutant that removed the sport predicate made the cross-sport same-name regression fail.
- A mutant that changed the cap comparison from `< 100` to `<= 100` made the bounded-evidence regression fail with 101 persisted entries.
- A mutant that changed zero-link resolution to `event_id_mismatch` made both missing-link precedence tests fail.
- A mutant that fell back to the sole named candidate after a wrong explicit id made the game-line wrong-id test grade the pick and fail.
- A mutant that bypassed event-name consistency for an explicit game-line id made the conflicting-name/id test grade the pick and fail.
- A mutant that removed sport filtering from the game-line named candidate set made the cross-sport-id test grade the pick and fail.
- Each mutant was removed with `apply_patch`; the restored full focused file then passed 117/117.

## Explicitly untouched

Manual operator settlement, Track Only delivery containment, CLV computation, provider ingestion, settlement writing, Discord delivery, kill switches, migrations, and database types/repositories were not changed.

## SHA Binding

Merge SHA: pending merge (`null` in `evidence.json`)
PR: https://github.com/griff843/Unit-Talk-v2/pull/1768
