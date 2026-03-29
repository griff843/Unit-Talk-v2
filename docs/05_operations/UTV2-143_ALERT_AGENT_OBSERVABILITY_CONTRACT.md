# Alert Agent Observability Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-143)
**Authority:** Defines `system_runs` row instrumentation for alert detection and notification passes.

---

## Problem

`runAlertDetectionPass()` and `runAlertNotificationPass()` produce results but write nothing to `system_runs`. There is no way to inspect alert agent cadence, identify stuck passes, or confirm last-run health from the operator dashboard without reading application logs. This is inconsistent with the worker and grading agent, both of which write `system_runs` rows.

---

## Design

### Detection pass instrumentation

In `apps/api/src/alert-agent-service.ts`, `runAlertDetectionPass()` wraps its execution in a `system_runs` row:

```typescript
// At start of runAlertDetectionPass():
const run = await repositories.systemRuns.createRun({
  runType: 'alert.detection',
  status: 'running',
  idempotencyKey: `alert.detection:${roundToMinute(now)}`,
});

// At end (success):
await repositories.systemRuns.completeRun(run.id, {
  status: 'succeeded',
  details: {
    evaluatedGroups: result.evaluatedGroups,
    detections: result.detections,
    signalsFound: result.persisted,
    alertWorthy: result.shouldNotifyCount,
    notable: countByTier(result.persistedSignals, 'notable'),
    watch: countByTier(result.persistedSignals, 'watch'),
  },
});

// On error:
await repositories.systemRuns.completeRun(run.id, {
  status: 'failed',
  details: { error: String(err) },
});
```

`idempotencyKey` uses the current minute (rounded) to prevent duplicate rows if the scheduler fires twice in the same minute. Uniqueness is enforced by the `system_runs_idempotency_key_idx` partial index (`WHERE status IN ('running', 'succeeded', 'failed')`).

If `enabled = false` (agent disabled via config), write a `succeeded` row with `details: { skipped: true, reason: 'agent-disabled' }` — do not skip instrumentation entirely.

### Notification pass instrumentation

In `runAlertNotificationPass()`:

```typescript
const run = await repositories.systemRuns.createRun({
  runType: 'alert.notification',
  status: 'running',
  idempotencyKey: `alert.notification:${roundToMinute(now)}`,
});

// At end (success):
await repositories.systemRuns.completeRun(run.id, {
  status: 'succeeded',
  details: {
    notified: result.notified,
    suppressed: result.suppressed,
    cooldownBlocked: result.cooldownBlocked,
  },
});
```

### Repository requirement

`runAlertDetectionPass` and `runAlertNotificationPass` must receive `repositories` extended with a `systemRuns` slot. The signature change:

```typescript
// Before:
export async function runAlertDetectionPass(
  repositories: Pick<{ providerOffers, alertDetections, events }, ...>,
  config?: AlertAgentConfig,
): Promise<RunAlertDetectionPassResult>

// After:
export async function runAlertDetectionPass(
  repositories: Pick<RepositoryBundle, 'providerOffers' | 'alertDetections' | 'events' | 'systemRuns'>,
  config?: AlertAgentConfig,
): Promise<RunAlertDetectionPassResult>
```

Call sites in `apps/api/src/alert-agent.ts` already receive `RepositoryBundle` — they pass the full bundle and TypeScript will accept the narrowed Pick.

---

## Operator Snapshot — `alertAgent` section

Add to `OperatorSnapshot`:

```typescript
export interface AlertAgentSummary {
  lastDetectionRun: {
    startedAt: string;
    status: 'succeeded' | 'failed' | 'running';
    signalsFound: number;
    alertWorthy: number;
  } | null;
  lastNotificationRun: {
    startedAt: string;
    status: 'succeeded' | 'failed' | 'running';
    notified: number;
    suppressed: number;
  } | null;
}

// In OperatorSnapshot:
alertAgent?: AlertAgentSummary;
```

Populated by querying `system_runs` for the most recent `alert.detection` and `alert.notification` rows:

```sql
SELECT * FROM system_runs WHERE run_type = 'alert.detection' ORDER BY created_at DESC LIMIT 1;
SELECT * FROM system_runs WHERE run_type = 'alert.notification' ORDER BY created_at DESC LIMIT 1;
```

---

## `roundToMinute` helper

```typescript
function roundToMinute(isoString: string): string {
  const d = new Date(isoString);
  d.setSeconds(0, 0);
  return d.toISOString();
}
```

---

## Migration Safety

No DB migrations. `system_runs` table and `run_type` column are already present. New `runType` string values (`alert.detection`, `alert.notification`) do not require schema changes.

---

## Acceptance Criteria (UTV2-143)

- [ ] `runAlertDetectionPass()` writes `system_runs` row with `runType='alert.detection'`
- [ ] Detection pass `details` includes: `evaluatedGroups`, `detections`, `signalsFound`, `alertWorthy`, `notable`, `watch`
- [ ] `runAlertNotificationPass()` writes `system_runs` row with `runType='alert.notification'`
- [ ] Notification pass `details` includes: `notified`, `suppressed`, `cooldownBlocked`
- [ ] Agent-disabled path writes `succeeded` row with `{ skipped: true, reason: 'agent-disabled' }`
- [ ] Idempotency key prevents duplicate rows within the same minute
- [ ] `OperatorSnapshot.alertAgent` section populated from most recent runs
- [ ] `pnpm verify` passes
- [ ] New tests:
  - Detection pass writes `system_runs` row with correct runType and details
  - Notification pass writes `system_runs` row with correct runType and details
  - Snapshot includes `alertAgent.lastDetectionRun` when a run row exists

---

## Out of Scope

- Alert agent health signal (`healthy/degraded/down`) on operator dashboard — that is a separate governance item
- Alerting on missed detection passes (no-run detection) — that is a separate monitoring item
- Per-signal granular audit trail
