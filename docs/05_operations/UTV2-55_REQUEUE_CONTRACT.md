# UTV2-55 — Qualified Pick Re-queue Contract

**Status:** RATIFIED
**Lane:** `lane:codex` (T2 implementation)
**Tier:** T2
**Milestone:** M9
**Ratified:** 2026-03-27
**Authority:** Claude lane — board investigation (see scoring analysis session 2026-03-27)

---

## Problem Statement

`submit-pick-controller.ts` silently catches enqueue failures at submission time (line 48: `catch { outboxEnqueued = false; }`). When the enqueue throws, the pick remains `promotion_status=qualified` with `promotion_target` set but no corresponding `distribution_outbox` row. There is no retry or recovery path. These picks are permanently orphaned.

**Current state:** 6 qualified picks stuck in `validated` lifecycle state with no outbox row. They will never reach Discord without manual intervention.

**Secondary finding:** The worker has no guard against delivering picks that are already `settled`. A stale `pending` outbox entry for a settled pick (`2783c8e2`) exists in the current DB.

---

## Scope

Two deliverables, one branch, one PR:

### 1. `POST /api/picks/:id/requeue`

New route on the API server. Operator-use only (not exposed to smart-form or discord-bot).

**Logic:**
1. Load pick by ID — 404 if not found
2. Check `pick.promotion_status === 'qualified'` and `pick.promotion_target != null` — 422 if not
3. Check `pick.status !== 'settled'` and `pick.status !== 'voided'` — 409 if already terminal
4. Query `distribution_outbox` for existing pending/sent row for this pick — 409 if exists
5. Call `enqueueDistributionWithRunTracking(pick, 'discord:{promotionTarget}', 'requeue', ...)`
6. Return 200 `{ outboxId, target, pickId }`

**Error responses:**
- `404` — pick not found
- `409` — already in outbox or pick is terminal
- `422` — pick is not qualified (`promotion_status !== 'qualified'`)

### 2. Worker guard: skip settled picks

In `apps/worker/src/distribution-worker.ts`, before delivery, add a check:
- Fetch the pick's current `status` from DB
- If `status === 'settled'` or `status === 'voided'`: mark outbox row as `skipped` (or complete it as no-op), log reason, do not attempt Discord delivery

---

## Acceptance Criteria

- [ ] AC-1: `POST /api/picks/:id/requeue` route registered on API server
- [ ] AC-2: Returns 422 if pick is not qualified
- [ ] AC-3: Returns 409 if outbox row already exists (pending or sent)
- [ ] AC-4: Returns 409 if pick is settled or voided
- [ ] AC-5: On success: enqueues to `distribution_outbox`, returns 200 with `{ outboxId, target, pickId }`
- [ ] AC-6: Worker skips delivery for settled/voided picks; logs reason; outbox row marked complete (not retried)
- [ ] AC-7: `pnpm verify` exits 0; test count ≥ current baseline + 3
- [ ] AC-8: At least 3 new tests: requeue success, requeue 422 (not qualified), requeue 409 (already queued)

---

## Constraints

- Do not change `submit-pick-controller.ts` error handling (separate concern)
- Do not change `distribution-service.ts` or `enqueueDistributionWithRunTracking` signatures
- Do not add the route to smart-form or operator-web
- Requeue is idempotent: calling twice returns 409 on second call (outbox row exists)
- Do not touch `apps/ingestor`, `apps/operator-web`, `apps/smart-form`
- Permitted files: `apps/api/src/server.ts` (route registration), new handler file `apps/api/src/controllers/requeue-controller.ts`, `apps/api/src/submission-service.test.ts` (or new test file), `apps/worker/src/distribution-worker.ts`

---

## Implementation Notes

```typescript
// Outbox check — existing pending or sent row
const existingRow = await repositories.outbox.findByPickAndTarget(
  pickId,
  `discord:${pick.promotionTarget}`
);
if (existingRow) return { status: 409, body: { error: 'ALREADY_QUEUED' } };
```

The `OutboxRepository` may need a `findByPickAndTarget` method added to the interface and both implementations (`InMemoryOutboxRepository`, `DatabaseOutboxRepository`). Check if it already exists before adding.

---

## Out of Scope

- Bulk re-queue of all orphaned picks (operator can call endpoint per pick)
- Automated retry on submission failure (separate T2 issue if needed)
- Changing `submission-service.ts` to surface enqueue errors to the caller

---

## Verification

After implementation, manually re-queue the 6 known orphaned picks:
- `d77a35b3` (trader-insights)
- `3b5d9e84` (best-bets)
- `306deff8` (best-bets)
- `d00954ec` (best-bets)
- `4701f767` (trader-insights)
- `3ec17a5e` (best-bets)

Confirm each gets an outbox row. Worker must be running to process them.
