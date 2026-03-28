# UTV2-69 — T3 Grading Cron: Scheduled Auto-Grade Trigger

**Status:** RATIFIED
**Lane:** `lane:codex` (T3 implementation)
**Tier:** T3
**Milestone:** M12
**Ratified:** 2026-03-27
**Authority:** Claude lane — M12 contract authoring session 2026-03-27
**Blocked by:** UTV2-68 (SGO results ingest) — grading is only meaningful once `game_results` rows are auto-populated

---

## Problem

`POST /api/grading/run` exists and works (T1 Automated Grading — CLOSED). It calls `runGradingPass()`, which grades all `posted` picks that have a matching `game_results` row. It is never called automatically.

UTV2-68 will auto-populate `game_results` after each SGO ingest cycle. Without a grading trigger, picks will remain in `posted` state until an operator manually calls the grading endpoint.

This contract wires a lightweight in-process interval that calls `runGradingPass()` automatically, on the same cadence as the SGO ingestor.

---

## Scope

**One new module. No new route. No new package. No new migration.**

### 1. New module — `apps/api/src/grading-scheduler.ts`

```typescript
export interface GradingSchedulerOptions {
  intervalMs: number;        // default: 300_000 (5 minutes — matches ingestor poll)
  repositories: Pick<
    RepositoryBundle,
    | 'picks'
    | 'settlements'
    | 'audit'
    | 'gradeResults'
    | 'participants'
    | 'events'
    | 'eventParticipants'
  >;
}

/**
 * Starts an interval loop that calls runGradingPass() on each tick.
 * Returns a cleanup function that clears the interval.
 */
export function startGradingScheduler(options: GradingSchedulerOptions): () => void
```

**Behavior:**
- Calls `runGradingPass(repositories)` on each interval tick
- Logs result: `graded`, `skipped`, `errors` counts at `info` level
- Suppresses ticks if a pass is already in-flight (no concurrent passes)
- If `graded > 0`, logs each graded pick ID and result
- If `errors > 0`, logs error details but does not throw or crash
- Returns a cleanup function (`clearInterval`) for graceful shutdown
- No-ops silently if `game_results` repository is not available (in-memory mode fallback)

### 2. Startup registration — `apps/api/src/index.ts`

Add scheduler start after server is listening:

```typescript
import { startGradingScheduler } from './grading-scheduler.js';

// After server.listen():
const stopGradingScheduler = startGradingScheduler({
  intervalMs: Number(process.env.GRADING_INTERVAL_MS ?? 300_000),
  repositories,
});

// On shutdown:
process.on('SIGTERM', () => { stopGradingScheduler(); });
process.on('SIGINT',  () => { stopGradingScheduler(); });
```

`GRADING_INTERVAL_MS` is optional — defaults to `300_000` (5 minutes). Not required in `.env.example` unless the default is changed.

---

## Non-Goals

- No new HTTP route — `POST /api/grading/run` already exists for manual invocation
- No persistence of "last graded at" across restarts — the pass is idempotent; re-running on restart is safe
- No separate process or external cron service — in-process interval only
- No Discord notification on grade result — that is a separate T2 lane
- No changes to `runGradingPass()` logic — consume as-is from `grading-service.ts`
- No operator dashboard changes — grading results appear in `settlement_records` which is already surfaced

---

## Permitted Files

- `apps/api/src/grading-scheduler.ts` — NEW: `startGradingScheduler()`
- `apps/api/src/grading-scheduler.test.ts` — NEW: ≥3 tests
- `apps/api/src/index.ts` — register scheduler on startup + shutdown

**Do NOT touch:** `apps/discord-bot`, `apps/worker`, `apps/operator-web`, `apps/ingestor`, `packages/*`, `apps/api/src/grading-service.ts`, `apps/api/src/server.ts`

---

## Acceptance Criteria

- [ ] AC-1: `startGradingScheduler()` calls `runGradingPass()` on each interval tick
- [ ] AC-2: Concurrent passes are suppressed — if a pass is in-flight when the next tick fires, the tick is skipped (no second pass starts)
- [ ] AC-3: `errors > 0` in a pass result is logged but does not throw or crash the scheduler
- [ ] AC-4: The cleanup function stops the interval — no further ticks after it is called
- [ ] AC-5: `GRADING_INTERVAL_MS` env var overrides the default interval
- [ ] AC-6: `pnpm verify` exits 0; test count ≥ baseline + 3

---

## Constraints

- Default interval: `300_000` ms (5 minutes) — matches SGO ingestor `pollIntervalMs`
- Idempotent by design: `runGradingPass()` already checks for existing settlements before writing; re-running is always safe
- Must not prevent API process from starting if grading-scheduler errors on init
- Fail-closed on startup: if repository bundle is missing required repos, log a warning and do not start the scheduler

---

## Dependency Note

UTV2-69 is blocked by UTV2-68 (SGO results ingest) in production — `game_results` rows are seeded manually until UTV2-68 merges. The scheduler code itself can be implemented and tested in parallel (it calls `runGradingPass()` which gracefully skips when no `game_results` rows match). Codex may implement UTV2-69 in the same PR as or after UTV2-68.
