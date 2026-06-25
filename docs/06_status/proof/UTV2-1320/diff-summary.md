# Diff Summary — UTV2-1320 Queue Readiness Semantics

**Lane:** UTV2-1320  
**Tier:** T2 governance  
**Branch:** claude/utv2-1320-queue-readiness-semantics  
**Generated at:** 2026-06-25T22:30:00Z

---

## Changes

### Files added

- `docs/05_operations/QUEUE_READINESS_SEMANTICS.md` — Queue bucket taxonomy (new document)
- `docs/06_status/proof/UTV2-1320/verification.md` — T2 proof
- `docs/06_status/proof/UTV2-1320/diff-summary.md` — this file

### Files modified

- `docs/06_status/readiness/readiness-score.json` — evidence fields updated to use bucket-aware language

---

## readiness-score.json delta

| Dimension | Field | Previous | Updated |
|---|---|---|---|
| `worker_outbox_health` | evidence | "0 true stuck rows. 594 pending >30min are all attempt_count=0..." | "594 pending >30min — ALL bucket:governance_hold... True delivery failures (bucket:true_failure): 0" |
| `dead_letter_count` | evidence | "946 DL rows, ALL attempt_count=0 (governance holds...)" | "946 dead_letter rows — ALL bucket:governance_hold... True delivery failures (bucket:true_failure, attempt_count>=max_attempts): 0" |
| (top-level) | queue_semantics_version | (not present) | "1.0" |
| (top-level) | queue_semantics_doc | (not present) | "docs/05_operations/QUEUE_READINESS_SEMANTICS.md" |

**Verdict: unchanged (GREEN).** Evidence is more precise but the underlying facts are identical — 0 true delivery failures.

---

## Scope

- No source changes
- No schema changes
- No migrations
- No queue mutations (no UPDATE/DELETE/INSERT on outbox rows)
- No test changes
- 4 docs files (1 new spec, 1 edit, 2 proof)

R-level check: PASS — no R-level artifacts required for docs-only diff

---

## Merge SHA Binding

**Merge SHA:** _to be bound by post-merge-lane-close.yml_  
**PR:** _pending_  
**Merged at:** _pending_
