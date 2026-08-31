import { OverviewDashboardClient } from '@/components/OverviewDashboardClient';
import { DegradedState } from '@/components/ui';
import { getDashboardData, getDashboardRuntimeData, getDailyPickCounts } from '@/lib/data';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { describeOperatorFailure } from '@/lib/describe-error';
import type { DashboardData, DashboardRuntimeData } from '@/lib/types';

export const metadata = { title: 'Executive Overview — Unit Talk Command Center' };

const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;

function readRefreshIntervalMs(searchParams?: Record<string, string | string[] | undefined>) {
  const raw = searchParams?.refresh;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(parsed, 5), 300) * 1000;
  }
  return DEFAULT_AUTO_REFRESH_INTERVAL_MS;
}

export default async function DashboardPage({
  searchParams: searchParamsPromise,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  let data: DashboardData | null = null;
  let runtime: DashboardRuntimeData | null = null;
  let dailyPickCounts: number[] | null = null;
  let loadError: string | null = null;
  try {
    const [dashboardData, dashboardRuntimeData, dailyCounts] = await Promise.all([
      getDashboardData(),
      getDashboardRuntimeData(),
      getDailyPickCounts(7),
    ]);
    data = dashboardData;
    runtime = dashboardRuntimeData;
    dailyPickCounts = dailyCounts ? dailyCounts.map((d) => d.count) : null;
  } catch (error) {
    loadError = describeOperatorFailure(error, 'Dashboard and runtime sources did not return an authoritative snapshot.');
  }

  const intervalMs = readRefreshIntervalMs(searchParams);

  if (!data || !runtime) {
    return (
      <DegradedState
        severity="critical"
        title="Overview truth unavailable"
        causes={[loadError ?? 'Dashboard and runtime sources did not return an authoritative snapshot.']}
        action={{ label: 'System Health', href: '/api-health' }}
      />
    );
  }

  const observedAt = data.observedAt;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-gray-500">Live operator snapshot across picks, pipeline flow, runtime health, and alerts.</p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={intervalMs} className="lg:min-w-[360px]" />
      </div>
      <OverviewDashboardClient data={data} runtime={runtime} dailyPickCounts={dailyPickCounts} />
    </div>
  );
}
