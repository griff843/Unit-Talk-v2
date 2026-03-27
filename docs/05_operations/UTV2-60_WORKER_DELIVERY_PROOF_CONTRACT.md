# UTV2-60 — T1 Worker Delivery Proof (AC-3/AC-4 from UTV2-56)

**Status:** RATIFIED
**Lane:** `lane:claude` (T1 verification only)
**Tier:** T1 (verify)
**Milestone:** M10
**Ratified:** 2026-03-27
**Blocked by:** Worker running (`pnpm install` must succeed; worker must poll)
**Authority:** Claude lane — M10 contract authoring session 2026-03-27

---

## Problem Statement

UTV2-56 (M9 closure verification) deferred two acceptance criteria because they require the distribution worker to be running:

- **AC-3**: Stale outbox entry for settled pick `2783c8e2-e84d-49c2-af16-9de8fc458896` (status=`pending`, target=`discord:trader-insights`). The UTV2-55 worker guard should claim it, detect the pick is settled, mark the outbox row as `sent` (no-op), write a `distribution.skipped` audit entry, and NOT deliver to Discord.
- **AC-4**: At least one of the 6 requeued picks (`d77a35b3`, `3b5d9e84`, `306deff8`, `d00954ec`, `4701f767`, `3ec17a5e`) gets a `distribution_receipts` row after the worker processes it.

These checks cannot be completed with DB-only queries — they require the worker to actually run and process the outbox.

**Current state:** All 6 orphaned picks have `distribution_outbox` rows (AC-1 of UTV2-56 confirmed). Idempotency confirmed (AC-2). AC-3 and AC-4 deferred pending worker availability. This issue tracks completing those two deferred checks.

---

## Scope

**Verification only. No code changes.**

### Prerequisite

1. Confirm `pnpm install` succeeds (clean dependency graph)
2. Start worker: `pnpm --filter @unit-talk/worker dev` (requires `SUPABASE_SERVICE_ROLE_KEY` and `DISCORD_BOT_TOKEN` in `local.env`)
3. Wait for worker to poll `distribution_outbox` (default poll interval: check `apps/worker/src/distribution-worker.ts`)

### AC-3 Verification — Stale settled pick guard

Target outbox row: `47036f38-...` (pick `2783c8e2`, settled, target=`discord:trader-insights`)

After worker runs, verify via live DB query:
- `distribution_outbox` row status = `sent` (or `skipped` depending on UTV2-55 implementation choice)
- `audit_log` has a `distribution.skipped` entry with `entity_ref` = `2783c8e2` (or the outbox row ID as `entity_id`)
- No Discord message delivered to channel `1356613995175481405` (trader-insights) for this pick

### AC-4 Verification — Requeued picks delivery

After worker runs, for the 6 requeued picks:
- Query `distribution_receipts` for any row where the outbox row corresponds to one of the 6 pick IDs
- At least 1 row must exist with `status = 'sent'` and `channel` field populated
- The corresponding pick's `status` in `picks` table should be `queued` or `posted`

---

## Acceptance Criteria

- [ ] AC-1: Worker starts successfully and polls `distribution_outbox` (log output confirms polling)
- [ ] AC-2: Stale outbox row for pick `2783c8e2` (settled): status transitions to `sent`, `distribution.skipped` audit entry written, no Discord delivery to `discord:trader-insights`
- [ ] AC-3: At least one of the 6 requeued outbox rows (`d77a35b3`, `3b5d9e84`, `306deff8`, `d00954ec`, `4701f767`, `3ec17a5e`) gets a `distribution_receipts` row with `status = 'sent'`
- [ ] AC-4: All delivered picks: `distribution_receipts.status = 'sent'`, `channel` field populated (not null)

---

## Constraints

- Do not change any runtime code — verification only
- Do not re-run `POST /api/picks/:id/requeue` for the 6 picks — outbox rows already exist (AC-1 of UTV2-56 confirmed)
- If worker fails to start (dependency issue, missing env var): document the blocker and exit — do not attempt workarounds
- If AC-2 cannot be confirmed (worker guard not firing): report the exact DB state and log output — do not patch the worker inline
- Preferred verification method: live Supabase DB query (MCP / Supabase dashboard) over runtime log parsing

---

## Verification Queries

```sql
-- AC-2: Check stale outbox row for settled pick
SELECT id, pick_id, target, status, claimed_at, updated_at
FROM distribution_outbox
WHERE pick_id = '2783c8e2-e84d-49c2-af16-9de8fc458896';

-- AC-2: Check for skipped audit entry
SELECT id, action, entity_id, entity_ref, created_at
FROM audit_log
WHERE entity_ref = '2783c8e2-e84d-49c2-af16-9de8fc458896'
  AND action = 'distribution.skipped';

-- AC-3/AC-4: Check receipts for requeued picks
SELECT dr.id, dr.status, dr.channel, do.pick_id, dr.created_at
FROM distribution_receipts dr
JOIN distribution_outbox do ON do.id = dr.outbox_id
WHERE do.pick_id IN (
  'd77a35b3-...', '3b5d9e84-...', '306deff8-...',
  'd00954ec-...', '4701f767-...', '3ec17a5e-...'
);
```

(Use full UUIDs from the DB — abbreviations above are for readability.)

---

## Out of Scope

- Verifying delivery to all 6 picks (at least 1 confirmed delivery satisfies AC-4)
- Investigating why the original enqueue failed at submission time (separate concern, UTV2-55 scope)
- Any code changes to the worker or API

---

## Closeout

When all 4 ACs pass:
1. Mark UTV2-56 DONE (all deferred ACs now resolved)
2. Update `docs/06_status/status_source_of_truth.md` — M9 CLOSED
3. Update `docs/06_status/ISSUE_QUEUE.md` — UTV2-56 → DONE, UTV2-60 → DONE
4. Add M10 placeholder to `status_source_of_truth.md` if not already present
