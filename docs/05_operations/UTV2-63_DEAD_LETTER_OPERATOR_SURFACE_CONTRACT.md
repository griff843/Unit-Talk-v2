# UTV2-63 — T3 Dead-Letter Operator Surface

**Status:** RATIFIED
**Lane:** `lane:augment` (T3 implementation)
**Tier:** T3
**Milestone:** M11
**Ratified:** 2026-03-27
**Authority:** Claude lane — M11 contract authoring session 2026-03-27
**Blocked by:** UTV2-62 (dead_letter status must exist before this has anything to count)

---

## Problem

Once UTV2-62 introduces `dead_letter` outbox status, operators need to see it in the dashboard. The current snapshot shows `failed` counts but not `dead_letter` counts, and does not break them down by target.

---

## Scope

Add `deadLetterCount: number` to the outbox health section of `OperatorSnapshot`. Surface it in the HTML dashboard card alongside the existing failed count.

**No new routes. No schema changes. No new DB queries beyond what `createSnapshotFromRows()` already handles.**

---

## Permitted Files

- `apps/operator-web/src/server.ts` — add `deadLetterCount` to the outbox health interface and `createSnapshotFromRows()` calculation; add HTML rendering for the new count
- `apps/operator-web/src/server.test.ts` — add ≥2 tests

**Do NOT touch:** `apps/api`, `apps/worker`, `apps/discord-bot`, `apps/smart-form`, `apps/ingestor`, `packages/*`

---

## Acceptance Criteria

- [ ] AC-1: `OperatorSnapshot` (or its outbox health sub-type) has `deadLetterCount: number`
- [ ] AC-2: `createSnapshotFromRows()` counts outbox rows with `status = 'dead_letter'`
- [ ] AC-3: Operator HTML dashboard shows "dead letter: N" in the outbox health card (alongside existing failed count)
- [ ] AC-4: `pnpm verify` exits 0; test count >= baseline + 2

---

## Constraints

- `deadLetterCount` defaults to `0` when no dead-letter rows exist — never undefined/null in the response
- Do not add a new health signal color for dead-letter — it contributes to the existing `degraded` state threshold (≥1 dead-letter row = degraded, same as existing failed logic)
- Wait for UTV2-62 to merge before starting — the `dead_letter` status string must exist in the worker before these counts are meaningful
