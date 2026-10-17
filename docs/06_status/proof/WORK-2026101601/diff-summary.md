# Diff summary: WORK-2026101601

Source SHA: `052d64ff5c5f0db57410a902a859d6e5792a7610`<br>
Base SHA: `1ea22eb8b1aaa199b94ae0d7629824d4d2ce4adb`<br>
Merge SHA: pending merge<br>
PR: https://github.com/griff843/Unit-Talk-v2/pull/1766

| File | Change |
|---|---|
| `apps/api/src/grading-service.ts` | Makes candidate-event selection return a classified failure instead of falling back, enforces a 36-hour maximum distance, rejects ambiguous nearest candidates, propagates the reason through both resolution paths, and stores bounded per-pick skip evidence in existing run-details JSON. |
| `apps/api/src/grading-service.test.ts` | Adds fail-closed, regression, Track Only, bounded-evidence, reason-propagation, and mutation-sensitive tests. Existing fixtures now carry reference times that truthfully exercise the 36-hour guard. |

Implementation diff: 2 files changed, 353 insertions, 29 deletions.

## Policy decisions

- `EVENT_MATCH_AMBIGUITY_WINDOW_MS` is six hours. Candidate games whose distance from the pick reference time differs by no more than six hours are not reliably distinguishable by time alone; this covers duplicate feeds, same-day reschedules, and nearby doubleheaders without guessing.
- `event_name_mismatch`, `event_match_ambiguous`, and `event_time_mismatch` are data-dependent skip reasons because each describes missing, non-unique, or temporally invalid provider event identity. They are retryable when provider data improves and therefore match the existing set's semantics.
- `GRADING_SKIP_EVIDENCE_LIMIT` is 100. Run details retain at most 100 `{pick_id, reason}` entries and separately record the number truncated, avoiding unbounded JSON growth without a schema change.

## Scope confirmation

- No migration, schema, generated DB type, lifecycle repository, distribution, authorization, worker, provider, CLV, delivery, containment, or kill-switch code changed.
- `recordOperatorEvidenceSettlement` was not changed.
- Existing run-detail fields and skip reasons remain; new detail fields are additive.

## SHA Binding

Merge SHA: pending merge<br>
PR: https://github.com/griff843/Unit-Talk-v2/pull/1766<br>
Verified source SHA: `052d64ff5c5f0db57410a902a859d6e5792a7610`
