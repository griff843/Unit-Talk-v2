import { Card } from '@/components/ui/Card';
import { ExceptionPanel } from '@/components/ExceptionPanel';
import { HealthSignalsPanel } from '@/components/HealthSignalsPanel';
import { PickLifecycleTable } from '@/components/PickLifecycleTable';
import { fetchDashboardData } from '@/lib/api';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import type { DashboardData, LifecycleSignal } from '@/lib/types';

const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;

/** Build drilldown links for health signals that have actionable detail pages */
function buildDrilldownLinks(
  signals: LifecycleSignal[],
): Partial<Record<LifecycleSignal['signal'], string>> {
  const links: Partial<Record<LifecycleSignal['signal'], string>> = {};

  for (const s of signals) {
    switch (s.signal) {
      case 'discord_delivery':
        // Failed or dead-letter outbox rows -> exceptions page filtered to delivery
        if (s.status !== 'WORKING') {
          links.discord_delivery = '/exceptions';
        }
        break;
      case 'submission':
        // Drill down to picks list showing recently submitted
        if (s.status !== 'WORKING') {
          links.submission = '/picks-list?status=validated';
        }
        break;
      case 'scoring':
        // Drill to picks missing scores
        if (s.status !== 'WORKING') {
          links.scoring = '/picks-list?status=validated';
        }
        break;
      case 'promotion':
        // Drill to review queue for pending promotions
        if (s.status !== 'WORKING') {
          links.promotion = '/review';
        }
        break;
      case 'settlement':
        // Manual review items in exceptions
        if (s.status !== 'WORKING') {
          links.settlement = '/exceptions';
        }
        break;
      default:
        break;
    }
  }

  return links;
}

const BROKEN_SIGNALS: LifecycleSignal[] = [
  { signal: 'submission', status: 'BROKEN', detail: 'API unreachable' },
  { signal: 'scoring', status: 'BROKEN', detail: 'API unreachable' },
  { signal: 'promotion', status: 'BROKEN', detail: 'API unreachable' },
  { signal: 'discord_delivery', status: 'BROKEN', detail: 'API unreachable' },
  { signal: 'settlement', status: 'BROKEN', detail: 'API unreachable' },
  { signal: 'stats_propagation', status: 'BROKEN', detail: 'API unreachable' },
];

function readRefreshIntervalMs(searchParams?: Record<string, string | string[] | undefined>) {
  const raw = searchParams?.refresh;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(parsed, 5), 300) * 1000;
  }
  return DEFAULT_AUTO_REFRESH_INTERVAL_MS;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  let data: DashboardData;
  try {
    data = await fetchDashboardData();
  } catch {
    data = {
      signals: BROKEN_SIGNALS,
      picks: [],
      stats: { total: 0, wins: 0, losses: 0, pushes: 0, roiPct: null },
      exceptions: [],
      observedAt: new Date().toISOString(),
    };
  }

  const observedAt = data.observedAt ?? new Date().toISOString();
  const intervalMs = readRefreshIntervalMs(searchParams);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100">Command Center</h1>
          <p className="text-sm text-gray-500">Operational overview for pick flow, queue health, and delivery status.</p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={intervalMs} className="lg:min-w-[360px]" />
      </div>

      <HealthSignalsPanel signals={data.signals} drilldownLinks={buildDrilldownLinks(data.signals)} />

      {data.exceptions.length > 0 && (
        <ExceptionPanel exceptions={data.exceptions} />
      )}

      <Card title="Stats Summary">
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-gray-400">Total</span>{' '}
            <span className="font-bold">{data.stats.total}</span>
          </div>
          <div>
            <span className="text-gray-400">W</span>{' '}
            <span className="font-bold text-green-400">{data.stats.wins}</span>
          </div>
          <div>
            <span className="text-gray-400">L</span>{' '}
            <span className="font-bold text-red-400">{data.stats.losses}</span>
          </div>
          <div>
            <span className="text-gray-400">P</span>{' '}
            <span className="font-bold text-gray-300">{data.stats.pushes}</span>
          </div>
          <div>
            <span className="text-gray-400">ROI</span>{' '}
            <span className="font-bold">
              {data.stats.roiPct != null
                ? `${data.stats.roiPct.toFixed(1)}%`
                : '—'}
            </span>
          </div>
        </div>
      </Card>

      <Card title="Pick Lifecycle">
        <PickLifecycleTable picks={data.picks} />
      </Card>
    </div>
  );
}
