# UTV2-1254 — Diff Summary

## Scope

Verification lane — **no production code changes**. Deliverables are this proof bundle only:

- `docs/06_status/proof/UTV2-1254/verification.md`
- `docs/06_status/proof/UTV2-1254/diff-summary.md`

## What was executed

- Live-DB validation queries for evidence flow, public-delivery suppression, settlement/grading, CLV join, and Command Center visibility (queries and counts in verification.md).
- One controlled grading pass via the production `grading-cron` entrypoint against live Supabase (Mode 1 evidence accumulation — sanctioned by `PICK_LIFECYCLE_AND_EVIDENCE_MODES.md`), producing 143 evidence-plane settlements; the local process was terminated after the validation window.
- Command Center unit tests (18/18 pass).

## Findings spawned

- **UTV2-1257** (Urgent): grading-cron has no managed runtime home; evidence settlement stopped 2026-06-08 when an unmanaged local process died.
- **UTV2-1258** (Urgent): `listByLifecycleState` unbounded select capped at 1000 oldest rows — grading never reaches newer CLV-join picks; also `UNIT_TALK_GRADING_CRON_MAX_CYCLES` not honored.
