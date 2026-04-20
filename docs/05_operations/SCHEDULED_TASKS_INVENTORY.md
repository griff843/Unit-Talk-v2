# Scheduled Tasks Inventory

Last updated: 2026-04-20
Issue: UTV2-609

## Current State

All scheduled tasks live inside the API process (`apps/api/src/index.ts`) as `setInterval` timers. This is single-process, in-memory scheduling with no distributed coordination.

## Task Inventory

| # | Task | Interval | Feature Flag | Writes To | Risk if Duplicated |
|---|------|----------|-------------|-----------|-------------------|
| 1 | **Recap scheduler** | Continuous (detects daily/weekly/monthly at 11:00 UTC) | None (always runs) | Discord posts via outbox | Duplicate Discord posts |
| 2 | **Trial expiry** | Scheduler-managed | None | member_tiers (deactivate) | Double deactivation (idempotent) |
| 3 | **Player enrichment** | 6 hours | None | participants table | Redundant API calls (safe) |
| 4 | **Team logo enrichment** | 6 hours (with player) | None | participants table | Redundant (safe) |
| 5 | **System pick scanner** | `SYSTEM_PICK_SCANNER_INTERVAL_MS` | `SYSTEM_PICK_SCANNER_ENABLED` | market_universe | Duplicate candidates (idempotent via key) |
| 6 | **Market universe materializer** | `MARKET_UNIVERSE_MATERIALIZER_INTERVAL_MS` | None (always) | market_universe | Upsert-safe (idempotent) |
| 7 | **Line movement detector** | `LINE_MOVEMENT_DETECTOR_INTERVAL_MS` | None | In-memory only | Safe (no writes) |
| 8 | **Board scan** | `BOARD_SCAN_INTERVAL_MS` | `SYNDICATE_MACHINE_ENABLED` | pick_candidates | Duplicate candidates (shadow_mode=true) |
| 9 | **Candidate scoring** | `CANDIDATE_SCORING_INTERVAL_MS` | None | pick_candidates (model_score) | Redundant scoring (overwrite-safe) |
| 10 | **Ranked selection** | `RANKED_SELECTION_INTERVAL_MS` | None | pick_candidates (selection_rank) | Redundant ranking (overwrite-safe) |
| 11 | **Board construction** | `BOARD_CONSTRUCTION_INTERVAL_MS` | None | syndicate_board | Duplicate board rows (run_id scoped) |

## Risk Assessment

### Duplicate-run risk by category

**High risk (external side effects):**
- Recap scheduler → could post duplicate Discord messages
- Mitigation: recap uses outbox with idempotency_key; duplicate enqueue prevented

**Medium risk (write duplication):**
- System pick scanner → could create duplicate market_universe rows
- Mitigation: upsert on idempotency_key
- Board construction → could create duplicate syndicate_board rows
- Mitigation: scoped by board_run_id; old runs are stale

**Low risk (idempotent or read-only):**
- All other tasks: either write via upsert (idempotent) or are read-only (line movement detector)
- Trial expiry: deactivation is idempotent (already-inactive rows are no-ops)
- Player enrichment: upsert-based, redundant runs are safe

### Crash recovery

If the API process crashes:
- All timers stop immediately (in-memory, no persistence)
- Outbox rows in `processing` state → stale claim reaper releases after 5min
- No scheduled task has state that survives restart — all resume from scratch
- Recap scheduler rechecks time window on restart — no missed recaps if restart is within window

## Safe Scheduling Strategy

### Current approach (single-process, acceptable for local runtime)

The current `setInterval` approach is safe for single-instance operation because:
1. Only one API process runs at a time (local laptop)
2. All write-path tasks use idempotent operations (upsert, idempotency_key)
3. The one high-risk task (recap) uses the outbox pattern with dedup
4. Crash recovery is handled by the outbox stale claim reaper

### Multi-instance strategy (required for hosted runtime)

When moving to hosted multi-instance deployment (UTV2-601 prerequisite):

**Option A: Leader election via Postgres advisory lock**
- On startup, each instance attempts `pg_try_advisory_lock(task_id)`
- Only the lock holder runs scheduled tasks
- Lock auto-releases on disconnect
- Simple, no external dependencies

**Option B: Externalize scheduling**
- Move scheduled tasks to a separate scheduler service or cron job
- Each task becomes an HTTP endpoint on the API
- Scheduler calls endpoints on the configured interval
- Clean separation of concerns

**Option C: Database-backed scheduling (pg_cron or custom)**
- Use Supabase pg_cron extension for server-side scheduling
- Tasks run inside the database context
- No process-level coordination needed

**Recommendation:** Option A (advisory locks) for initial hosted deployment. Simplest, no new infrastructure, works with existing Supabase. Transition to Option B when task count or complexity warrants it.

### Implementation notes for Option A

```typescript
// Before starting any scheduled task:
const lockId = hashTaskName(taskName); // deterministic int from task name
const { data } = await db.rpc('pg_try_advisory_lock', { key: lockId });
if (!data) {
  // Another instance holds the lock — skip
  return;
}
// Lock acquired — run the task
// Lock auto-releases when connection drops
```

No code changes needed for current single-instance operation. The advisory lock wrapper is additive — ship when hosted deployment starts.

## Ownership

| Task | Owner |
|------|-------|
| Recap scheduler | API service |
| Trial expiry | API service |
| Enrichment (player, team) | API service |
| Syndicate machine (scanner, materializer, scoring, ranking, construction) | API service |
| Line movement detection | API service |

All tasks are owned by the API process. No cross-service scheduling exists.
