import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { ProviderHealthCard, Card } from '@/components/ui';
import { getProviderHealth, getSnapshotData } from '@/lib/data';
import { getProviderCycleLatencySamples } from '@/lib/data/provider-cycle-health';
import { buildApiHealthPageData } from '@/lib/command-center-page-data';

export default async function ApiHealthPage() {
  const [providerHealth, snapshot, latencySamples] = await Promise.all([
    getProviderHealth(),
    getSnapshotData(),
    getProviderCycleLatencySamples(),
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
