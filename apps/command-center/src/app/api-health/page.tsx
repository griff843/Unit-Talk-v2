import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { ProviderHealthCard, Card } from '@/components/ui';
import { getProviderHealth, getSnapshotData } from '@/lib/data';
import { getProviderCycleLatencySamples } from '@/lib/data/provider-cycle-health';
import { buildApiHealthPageData } from '@/lib/command-center-page-data';
import { fetchRuntimeTruth } from '@/lib/server-api';
import type { RuntimeTruthReport } from '@unit-talk/observability';

export default async function ApiHealthPage() {
  const [providerHealth, snapshot, latencySamples, runtimeTruthState] = await Promise.all([
    getProviderHealth(),
    getSnapshotData(),
    getProviderCycleLatencySamples(),
    fetchRuntimeTruth()
      .then((runtimeTruth) => ({ runtimeTruth, error: null as string | null }))
      .catch((error: unknown) => ({
        runtimeTruth: null,
        error: error instanceof Error ? error.message : String(error),
      })),
  ]);

  const cards = buildApiHealthPageData(providerHealth, snapshot, latencySamples);
  const observedAt = new Date().toISOString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100">API Health</h1>
          <p className="text-sm text-gray-500">
            External provider freshness, quota pressure, and ingestion latency from current runtime telemetry.
          </p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={30_000} className="lg:min-w-[360px]" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {cards.map((card) => (
          <ProviderHealthCard
            key={card.provider}
            provider={card.provider}
            status={card.status}
            responseMs={card.responseMs}
            quotaPct={card.quotaPct}
            callsToday={card.callsToday}
            lastCheckedAt={card.lastCheckedAt}
            sparkline={card.sparkline}
          />
        ))}
      </div>

      <RuntimeTruthPanel
        runtimeTruth={runtimeTruthState.runtimeTruth}
        error={runtimeTruthState.error}
      />

      <Card title="Provider Notes">
        <div className="grid gap-3 xl:grid-cols-2">
          {cards.map((card) => (
            <div key={`${card.provider}-note`} className="rounded-2xl border border-[var(--cc-border-subtle)] bg-white/[0.02] p-4">
              <div className="text-sm font-semibold text-[var(--cc-text-primary)]">{card.provider}</div>
              <div className="mt-2 text-sm text-[var(--cc-text-secondary)]">{card.detail}</div>
            </div>
          ))}
        </div>
      </Card>
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
        <RuntimeTruthMetric label="Mode" value={runtimeTruth.runtimeMode} detail={runtimeTruth.persistenceMode} />
        <RuntimeTruthMetric label="Auth" value={runtimeTruth.auth.mode} detail={runtimeTruth.auth.enabled === null ? 'not applicable' : runtimeTruth.auth.enabled ? 'operator API key active' : 'fail-open bypass'} />
        <RuntimeTruthMetric label="Last work" value={formatLastWork(runtimeTruth.work.lastWorkAt)} detail={`observed ${formatLastWork(runtimeTruth.observedAt)}`} />
        <RuntimeTruthMetric label="Targets" value={formatTargets(runtimeTruth.work.workerTargets)} detail={runtimeTruth.work.dryRun ? 'dry-run enabled' : 'live side effects allowed'} />
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

function RuntimeTruthMetric({
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

function formatTargets(targets: string[]) {
  return targets.length > 0 ? targets.join(', ') : 'none';
}

function formatLastWork(value: string | null) {
  if (!value) return 'none';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}
