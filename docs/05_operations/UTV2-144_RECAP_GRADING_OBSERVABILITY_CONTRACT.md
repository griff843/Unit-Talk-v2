# Recap/Grading Observability Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-144)
**Authority:** Defines `system_runs` row instrumentation for grading and recap passes.

---

## Problem

`runGradingPass()` and `postRecapSummary()` write no `system_runs` rows. There is no operator-visible record of when grading last ran, how many picks it processed, or whether the most recent recap succeeded. This mirrors the gap fixed for the distribution worker — grading and recap now need the same instrumentation pattern.

---

## Design

### Grading pass instrumentation

In `apps/api/src/grading-service.ts`, `runGradingPass()` wraps its execution in a `system_runs` row:

```typescript
const run = await repositories.systemRuns.createRun({
  runType: 'grading.run',
  status: 'running',
  idempotencyKey: `grading.run:${roundToMinute(new Date().toISOString())}`,
});

// At end (success):
await repositories.systemRuns.completeRun(run.id, {
  status: 'succeeded',
  details: {
    picksEvaluated: result.details.length,
    picksGraded: result.details.filter(d => d.outcome === 'graded').length,
    picksSkipped: result.details.filter(d => d.outcome === 'skipped').length,
    picksFailed: result.details.filter(d => d.outcome === 'error').length,
  },
});

// On error:
await repositories.systemRuns.completeRun(run.id, {
  status: 'failed',
  details: { error: String(err) },
});
```

`runGradingPass` already receives `repositories: Pick<RepositoryBundle, ...>`. Extend the Pick to include `systemRuns`.

### Recap pass instrumentation

In `apps/api/src/recap-service.ts`, `postRecapSummary()` wraps its execution in a `system_runs` row:

```typescript
const run = await repositories.systemRuns.createRun({
  runType: 'recap.post',
  status: 'running',
  idempotencyKey: `recap.post:${period}:${roundToMinute(new Date().toISOString())}`,
});

// On success:
await repositories.systemRuns.completeRun(run.id, {
  status: 'succeeded',
  details: {
    channel,
    pickCount: summary?.picks.length ?? 0,
    dryRun: result.dryRun ?? false,
    period,
  },
});

// On skip (no settled picks):
await repositories.systemRuns.completeRun(run.id, {
  status: 'succeeded',
  details: { skipped: true, reason: result.reason, period },
});

// On failure:
await repositories.systemRuns.completeRun(run.id, {
  status: 'failed',
  details: { reason: result.reason, period },
});
```

`postRecapSummary` currently receives `repositories: Pick<RepositoryBundle, 'settlements' | 'picks'>`. Extend to include `systemRuns`.

### `idempotencyKey` for recap

The key includes `period` to distinguish daily vs weekly recap runs that fire in the same minute:
- `recap.post:daily:2026-03-29T14:00:00.000Z`
- `recap.post:weekly:2026-03-29T14:00:00.000Z`

---

## Operator Snapshot — `gradingAgent` section

Add to `OperatorSnapshot`:

```typescript
export interface GradingAgentSummary {
  lastGradingRun: {
    startedAt: string;
    status: 'succeeded' | 'failed' | 'running';
    picksGraded: number;
    picksFailed: number;
  } | null;
  lastRecapPost: {
    startedAt: string;
    status: 'succeeded' | 'failed' | 'running';
    channel: string;
    pickCount: number;
    dryRun: boolean;
  } | null;
}

// In OperatorSnapshot:
gradingAgent?: GradingAgentSummary;
```

Populated by querying `system_runs` for most recent `grading.run` and `recap.post` rows:

```sql
SELECT * FROM system_runs WHERE run_type = 'grading.run' ORDER BY created_at DESC LIMIT 1;
SELECT * FROM system_runs WHERE run_type = 'recap.post' ORDER BY created_at DESC LIMIT 1;
```

---

## `roundToMinute` helper

Shared with `UTV2-143`. Extract to `apps/api/src/run-utils.ts` (or include inline in each service — implementation choice for codex):

```typescript
export function roundToMinute(isoString: string): string {
  const d = new Date(isoString);
  d.setSeconds(0, 0);
  return d.toISOString();
}
```

---

## Migration Safety

No DB migrations. `system_runs` table already present. New `runType` values (`grading.run`, `recap.post`) require no schema changes.

---

## Acceptance Criteria (UTV2-144)

- [ ] `runGradingPass()` writes `system_runs` row with `runType='grading.run'`
- [ ] Grading pass `details` includes: `picksEvaluated`, `picksGraded`, `picksSkipped`, `picksFailed`
- [ ] `postRecapSummary()` writes `system_runs` row with `runType='recap.post'`
- [ ] Recap pass `details` includes: `channel`, `pickCount`, `dryRun`, `period`
- [ ] Skip path (no settled picks) writes `succeeded` row with `{ skipped: true, reason, period }`
- [ ] Failure path writes `failed` row with `{ reason, period }`
- [ ] Idempotency key prevents duplicate rows within the same minute + period
- [ ] `OperatorSnapshot.gradingAgent` section populated from most recent runs
- [ ] `pnpm verify` passes
- [ ] New tests:
  - Grading pass writes `system_runs` row with correct `runType` and `details`
  - Recap pass (success) writes `system_runs` row with correct `runType`, `channel`, `pickCount`
  - Recap pass (skip) writes `succeeded` row with `skipped: true`
  - Snapshot includes `gradingAgent.lastGradingRun` when a run row exists

---

## Out of Scope

- Grading health signal (`healthy/degraded/down`) on operator dashboard
- Grading failure alerting
- Per-pick grading audit trail (that is in `audit_log` already)
