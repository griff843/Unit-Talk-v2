# UTV2-62 — T2 Dead-Letter Promotion for Failed Outbox Rows

**Status:** RATIFIED
**Lane:** `lane:codex` (T2 implementation)
**Tier:** T2
**Milestone:** M11
**Ratified:** 2026-03-27
**Authority:** Claude lane — M11 contract authoring session 2026-03-27

---

## Problem

`distribution_outbox` rows that fail repeatedly stay at `status=failed` indefinitely. The schema has `attempt_count` and `last_error` but no application-layer logic promotes persistently stuck rows to a distinct `dead_letter` state. Operator triage cannot distinguish "just failed" from "permanently stuck."

---

## Scope

Add `dead_letter` promotion to the worker delivery path. After N consecutive failures on the same outbox row, the worker promotes it to `dead_letter` instead of leaving it at `failed`.

**No schema change required** — `status` column already accepts arbitrary string values (no DB-level enum constraint on `distribution_outbox.status`).

---

## Permitted Files

- `packages/db/src/repositories.ts` — add `markDeadLetter(outboxId: string, reason: string): Promise<OutboxRecord>` to `OutboxRepository` interface
- `packages/db/src/runtime-repositories.ts` — implement `markDeadLetter` in both `InMemoryOutboxRepository` and `DatabaseOutboxRepository`
- `apps/worker/src/distribution-worker.ts` — after marking failed, check `attempt_count`; if `>= DEAD_LETTER_THRESHOLD` (default: 3), call `markDeadLetter` instead of / in addition to `markFailed`
- `apps/worker/src/worker-runtime.test.ts` — add ≥3 tests

**Do NOT touch:** `apps/api`, `apps/operator-web`, `apps/discord-bot`, `apps/smart-form`, `apps/ingestor`

---

## Acceptance Criteria

- [ ] AC-1: `OutboxRepository` interface has `markDeadLetter(outboxId, reason): Promise<OutboxRecord>`
- [ ] AC-2: `InMemoryOutboxRepository.markDeadLetter` sets `status = 'dead_letter'`, writes `last_error = reason`
- [ ] AC-3: `DatabaseOutboxRepository.markDeadLetter` sets `status = 'dead_letter'`, writes `last_error = reason` in Supabase
- [ ] AC-4: Worker promotes to `dead_letter` after `attempt_count >= 3` consecutive failures on the same row
- [ ] AC-5: Dead-lettered rows are NOT retried on subsequent worker polls (worker's `claimNext` must exclude `dead_letter` status — verify it already does via existing status filter)
- [ ] AC-6: `pnpm verify` exits 0; test count >= baseline + 3

---

## Constraints

- `DEAD_LETTER_THRESHOLD = 3` — hardcoded constant, not env-configurable for now
- `markDeadLetter` must be idempotent — calling it twice on the same row is safe
- Do not change the existing `claimNext` query unless it currently claims `dead_letter` rows (it shouldn't — check before changing)
- Do not add a new DB migration — `dead_letter` is a string status value, not a schema enum change
