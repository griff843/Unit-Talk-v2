import { OverviewDashboardClient } from '@/components/OverviewDashboardClient';
import { getDashboardData, getDashboardRuntimeData } from '@/lib/data';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import type { DashboardData, DashboardRuntimeData, LifecycleSignal } from '@/lib/types';

const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;

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
  let runtime: DashboardRuntimeData;
  try {
    const [dashboardData, dashboardRuntimeData] = await Promise.all([
      getDashboardData(),
      getDashboardRuntimeData(),
    ]);
    data = dashboardData;
    runtime = dashboardRuntimeData;
  } catch {
    data = {
      signals: BROKEN_SIGNALS,
      picks: [],
      stats: { total: 0, wins: 0, losses: 0, pushes: 0, roiPct: null },
      exceptions: [],
      observedAt: new Date().toISOString(),
    };
    runtime = {
      outbox: {
        pending: 0,
        processing: 0,
        sent: 0,
        failed: 0,
        deadLetter: 0,
        simulated: 0,
      },
      worker: {
        drainState: 'unknown',
        detail: 'Unavailable',
        latestRunAt: null,
        latestReceiptAt: null,
      },
      aging: {
        staleValidated: 0,
        stalePosted: 0,
        staleProcessing: 0,
      },
      deliveryTargets: [],
      providerSummary: {
        active: 0,
        stale: 0,
        absent: 0,
        distinctEventsLast24h: 0,
        ingestorStatus: 'unknown',
        latestLiveSnapshotAt: null,
      },
      providerCycleSummary: {
        overallStatus: 'warning',
        trackedLanes: 0,
        mergedLanes: 0,
        blockedLanes: 0,
        failedLanes: 0,
        staleLanes: 0,
        proofRequiredLanes: 0,
        latestCycleSnapshotAt: null,
        latestUpdatedAt: null,
      },
      receipts: {
        sent: 0,
        failed: 0,
        simulated: 0,
        lastSentAt: null,
        lastFailedAt: null,
      },
      grading: {
        lastGradingRunAt: null,
        lastGradingRunStatus: null,
        lastPicksGraded: null,
        lastFailed: null,
        lastRecapPostAt: null,
        lastRecapChannel: null,
        runCount: 0,
      },
      observability: {
        failedRuns: 0,
        activeIncidents: 0,
        pendingOutboxAgeMaxMinutes: null,
        latestDistributionRunAt: null,
        latestIngestorRunAt: null,
        latestWorkerHeartbeatAt: null,
        alertConditions: [],
      },
      db: {
        disk: {
          provisionedGiB: 0,
          usedGiB: 0,
          availableGiB: 0,
          usedPct: 0,
          iops: 0,
          throughputMiBps: 0,
          diskType: 'unknown',
          observedAt: new Date().toISOString(),
          projectedDaysToFull: null,
          alertStatus: 'stable',
        },
        connections: {
          used: 0,
          max: 0,
          waiting: 0,
        },
        locks: {
          waiting: 0,
        },
        longTransactions: {
          count: 0,
          maxAgeSeconds: 0,
        },
        slowQueries: {
          count: 0,
          maxAgeSeconds: 0,
        },
        wal: {
          sizeGiB: 0,
          estimatedGrowthGiBPerDay: 0,
          archiveMode: 'unknown',
          archiveConfigured: false,
        },
        backups: {
          pitrEnabled: false,
          walGEnabled: false,
          lastBackupAt: null,
          lastBackupStatus: null,
          restorePointCount: 0,
        },
        storageDomains: [],
        topGrowthSources: [],
      },
      baseline: {
        normal: [],
        abnormal: [],
      },
    };
  }

  const observedAt = data.observedAt ?? new Date().toISOString();
  const intervalMs = readRefreshIntervalMs(searchParams);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100">Overview</h1>
          <p className="text-sm text-gray-500">Live operator snapshot across picks, pipeline flow, runtime health, and alerts.</p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={intervalMs} className="lg:min-w-[360px]" />
      </div>
      <OverviewDashboardClient data={data} runtime={runtime} />
    </div>
  );
}
