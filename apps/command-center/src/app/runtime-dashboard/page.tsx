import type { QueueHealthEvaluation, RuntimeTruthReport } from '@unit-talk/observability';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { Card } from '@/components/ui';
import { fetchRuntimeTruth, fetchRuntimeHealth } from '@/lib/server-api';

export default async function RuntimeDashboardPage() {
  const [runtimeTruthState, runtimeHealthState] = await Promise.all([
    fetchRuntimeTruth()
      .then((runtimeTruth) => ({ runtimeTruth, error: null as string | null }))
      .catch((error: unknown) => ({
        runtimeTruth: null,
        error: error instanceof Error ? error.message : String(error),
      })),
    fetchRuntimeHealth()
      .then((health) => ({ health, error: null as string | null }))
      .catch((error: unknown) => ({
        health: null,
        error: error instanceof Error ? error.message : String(error),
      })),
  ]);

  const observedAt = new Date().toISOString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100">Runtime Dashboard</h1>
          <p className="text-sm text-gray-500">
            Live queue health, delivery freshness, and runtime mode — values from runtime endpoints, not static docs.
          </p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={30_000} className="lg:min-w-[360px]" />
      </div>

      <RuntimeTruthPanel
        runtimeTruth={runtimeTruthState.runtimeTruth}
        error={runtimeTruthState.error}
      />

      <QueueHealthPanel
        queueHealth={runtimeHealthState.health?.queueHealth ?? null}
        warnings={runtimeHealthState.health?.warnings ?? []}
        error={runtimeHealthState.error}
      />
    </div>
  );
}

function RuntimeTruthPanel({
  runtimeTruth,
  error,
}: {
  runtimeTruth: RuntimeTruthReport | null;
  error: string | null;
}) {
  if (!runtimeTruth) {
    return (
      <Card title="Runtime Truth">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          Runtime truth unavailable: {error ?? 'unknown error'}
        </div>
      </Card>
    );
  }

  const workTone = runtimeTruth.work.doingRealWork
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-100';

  return (
    <Card title="Runtime Truth">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DashboardMetric label="Mode" value={runtimeTruth.runtimeMode} detail={runtimeTruth.persistenceMode} />
        <DashboardMetric
          label="Auth"
          value={runtimeTruth.auth.mode}
          detail={runtimeTruth.auth.enabled === null ? 'not applicable' : runtimeTruth.auth.enabled ? 'operator API key active' : 'fail-open bypass'}
        />
        <DashboardMetric label="Last work" value={formatTimestamp(runtimeTruth.work.lastWorkAt)} detail={`observed ${formatTimestamp(runtimeTruth.observedAt)}`} />
        <DashboardMetric
          label="Targets"
          value={runtimeTruth.work.workerTargets.length > 0 ? runtimeTruth.work.workerTargets.join(', ') : 'none'}
          detail={runtimeTruth.work.dryRun ? 'dry-run enabled' : 'live side effects allowed'}
        />
      </div>
      <div className={`mt-4 rounded-2xl border p-4 text-sm ${workTone}`}>
        <div className="font-semibold">
          {runtimeTruth.work.doingRealWork ? 'Doing real work' : 'Not doing real work'}
        </div>
        <div className="mt-1 text-xs opacity-85">{runtimeTruth.work.reason}</div>
      </div>
    </Card>
  );
}

function QueueHealthPanel({
  queueHealth,
  warnings,
  error,
}: {
  queueHealth: QueueHealthEvaluation | null;
  warnings: string[];
  error: string | null;
}) {
  if (error && !queueHealth) {
    return (
      <Card title="Queue Health">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          Queue health unavailable: {error}
        </div>
      </Card>
    );
  }

  if (!queueHealth) {
    return (
      <Card title="Queue Health">
        <div className="rounded-2xl border border-[var(--cc-border-subtle)] bg-white/[0.02] p-4 text-sm text-[var(--cc-text-secondary)]">
          No queue health data — worker not reporting.
        </div>
      </Card>
    );
  }

  const statusTone =
    queueHealth.status === 'healthy'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
      : queueHealth.status === 'degraded'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
        : 'border-red-500/30 bg-red-500/10 text-red-100';

  return (
    <Card title="Queue Health">
      <div className={`mb-4 rounded-2xl border p-3 text-sm font-semibold ${statusTone}`}>
        {queueHealth.status.toUpperCase()}
        {queueHealth.silentStrandingRisk && (
          <span className="ml-2 text-xs font-normal opacity-75">⚠ silent stranding risk</span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DashboardMetric
          label="Oldest pending"
          value={formatAgeMs(queueHealth.oldestPendingAgeMs)}
          detail={queueHealth.oldestPendingTarget ? `target: ${queueHealth.oldestPendingTarget}` : 'no pending rows'}
        />
        <DashboardMetric
          label="Last delivery"
          value={formatAgeMs(queueHealth.lastSuccessfulDeliveryAgeMs)}
          detail={queueHealth.lastSuccessfulDeliveryAt ? formatTimestamp(queueHealth.lastSuccessfulDeliveryAt) : 'no delivery recorded'}
        />
        <DashboardMetric
          label="Pending / Failed"
          value={`${queueHealth.pendingCount} / ${queueHealth.failedCount}`}
          detail={`dead-letter: ${queueHealth.deadLetterCount}  depth: ${queueHealth.queueDepth}`}
        />
        <DashboardMetric
          label="Targets"
          value={queueHealth.workerTargets.length > 0 ? queueHealth.workerTargets.join(', ') : 'none'}
          detail={`processing: ${queueHealth.processingCount}`}
        />
      </div>

      {queueHealth.alerts.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {queueHealth.alerts.map((alert, index) => {
            const alertTone =
              alert.level === 'critical'
                ? 'border-red-500/30 bg-red-500/10 text-red-100'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-100';
            return (
              <div key={index} className={`rounded-2xl border p-3 text-sm ${alertTone}`}>
                <div className="font-semibold">{alert.message}</div>
                {alert.remediation && (
                  <div className="mt-1 text-xs opacity-75">{alert.remediation}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {warnings.map((w, i) => (
            <div key={i} className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              {w}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DashboardMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--cc-border-subtle)] bg-white/[0.02] p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-text-muted)]">{label}</div>
      <div className="mt-2 break-words text-sm font-semibold text-[var(--cc-text-primary)]">{value}</div>
      <div className="mt-1 break-words text-xs text-[var(--cc-text-secondary)]">{detail}</div>
    </div>
  );
}

function formatAgeMs(ms: number | null): string {
  if (ms === null) return 'none';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'none';
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(ts));
}
