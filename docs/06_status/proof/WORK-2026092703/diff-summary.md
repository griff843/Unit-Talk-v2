# Diff summary: WORK-2026092703

| File | Change |
|---|---|
| `scripts/ops/pipeline-health-classification.ts` | Adds `deadLetterBucket` and `partitionDeadLetters`, which apply the readiness gate's rule through `classifyDeadLetter`. Adds `countByReasonClass`, and `readAllPages`, an `id`-ordered paged reader that runs until an empty page and de-duplicates by id. |
| `scripts/ops/pipeline-health-classification.test.ts` | 7 new tests: row-for-row parity with `bucketDeadLetterRows`, the fail-closed attempt default, pass-through of non-dead rows, and paging against a capped fake whose unordered reads are unstable. |
| `scripts/pipeline-health.ts` | Replaces the capped single read with `readAllPages` plus an exact non-sent count. An incomplete read is critical and exits 1. The local prefix rule is replaced by the canonical buckets, and only true failures reach `evaluateQueueHealth`. Governance and unattempted rows are summarised by class and target instead of ~1950 INFO lines. The JSON gains `outbox_dead_letter_unattempted_unclassified_count`, `outbox_non_sent_count` and `outbox_read_complete`. |
| `.ops/work/WORK-2026092703.md` | The repo-owned work order. |

Not changed: `packages/observability`, `outbox-triage.ts`, `readiness-refresh.ts`, the worker, the monitor workflow, and any database row.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1669
