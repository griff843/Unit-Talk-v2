import { Card } from '@/components/ui/Card';
import { ExceptionPanel } from '@/components/ExceptionPanel';
import { HealthSignalsPanel } from '@/components/HealthSignalsPanel';
import { PickLifecycleTable } from '@/components/PickLifecycleTable';
import { getDashboardData, getDashboardRuntimeData, getExceptionQueues } from '@/lib/data';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import type { DashboardData, DashboardRuntimeData, LifecycleSignal } from '@/lib/types';

const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;

function buildDrilldownLinks(
  signals: LifecycleSignal[],
): Partial<Record<LifecycleSignal['signal'], string>> {
  const links: Partial<Record<LifecycleSignal['signal'], string>> = {};

  for (const s of signals) {
    switch (s.signal) {
      case 'discord_delivery':
        if (s.status !== 'WORKING') {
          links.discord_delivery = '/exceptions';
        }
        break;
      case 'submission':
        if (s.status !== 'WORKING') {
          links.submission = '/picks-list?status=validated';
        }
        break;
      case 'scoring':
        if (s.status !== 'WORKING') {
          links.scoring = '/picks-list?status=validated';
        }
        break;
      case 'promotion':
        if (s.status !== 'WORKING') {
          links.promotion = '/review';
        }
        break;
      case 'settlement':
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

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

function formatDaysToFull(value: number | null) {
  return value == null ? '-' : `${value.toFixed(1)}d`;
}

function diskTone(status: DashboardRuntimeData['db']['disk']['alertStatus']) {
  switch (status) {
    case 'critical':
      return 'text-red-300';
    case 'warning':
      return 'text-amber-300';
    case 'watch':
      return 'text-yellow-300';
    default:
      return 'text-emerald-300';
  }
}

function cycleStatusTone(status: DashboardRuntimeData['providerCycleSummary']['overallStatus']) {
  switch (status) {
    case 'healthy':
      return 'text-emerald-300';
    case 'warning':
      return 'text-amber-300';
    default:
      return 'text-red-300';
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  let data: DashboardData;
  let runtime: DashboardRuntimeData;
  let aliasReviewCounts = { missingBookAliases: 0, missingMarketAliases: 0 };

  try {
    const [dashboardData, dashboardRuntimeData, exceptionQueues] = await Promise.all([
      getDashboardData(),
      getDashboardRuntimeData(),
      getExceptionQueues(),
    ]);
    data = dashboardData;
    runtime = dashboardRuntimeData;
    const queueResponse = exceptionQueues as { data?: { counts?: Record<string, unknown> } };
    const counts = queueResponse?.data?.counts ?? {};
    aliasReviewCounts = {
      missingBookAliases: typeof counts['missingBookAliases'] === 'number' ? counts['missingBookAliases'] : 0,
      missingMarketAliases: typeof counts['missingMarketAliases'] === 'number' ? counts['missingMarketAliases'] : 0,
    };
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
          <h1 className="text-lg font-bold text-gray-100">Command Center</h1>
          <p className="text-sm text-gray-500">Operational overview for pick flow, queue health, delivery status, and provider cycle staging.</p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={intervalMs} className="lg:min-w-[360px]" />
      </div>

      <HealthSignalsPanel signals={data.signals} drilldownLinks={buildDrilldownLinks(data.signals)} />

      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
        <Card title="Delivery State">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-400">Pending</span> <span className="font-bold">{runtime.outbox.pending}</span></div>
            <div><span className="text-gray-400">Processing</span> <span className="font-bold">{runtime.outbox.processing}</span></div>
            <div><span className="text-gray-400">Sent</span> <span className="font-bold text-green-400">{runtime.outbox.sent}</span></div>
            <div><span className="text-gray-400">Failed</span> <span className="font-bold text-yellow-400">{runtime.outbox.failed}</span></div>
            <div><span className="text-gray-400">Dead-letter</span> <span className="font-bold text-red-400">{runtime.outbox.deadLetter}</span></div>
            <div><span className="text-gray-400">Simulated</span> <span className="font-bold">{runtime.outbox.simulated}</span></div>
          </div>
          <div className="mt-4 space-y-1 text-xs text-gray-500">
            <div>Stale validated: {runtime.aging.staleValidated}</div>
            <div>Stale posted: {runtime.aging.stalePosted}</div>
            <div>Stale processing: {runtime.aging.staleProcessing}</div>
          </div>
        </Card>

        <Card title="Worker Runtime">
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-400">Drain state</span>{' '}
              <span className="font-bold text-gray-100">{runtime.worker.drainState}</span>
            </div>
            <div className="text-xs text-gray-500">{runtime.worker.detail}</div>
            <div className="text-xs text-gray-500">
              Latest run: {formatTimestamp(runtime.worker.latestRunAt)}
            </div>
            <div className="text-xs text-gray-500">
              Latest receipt: {formatTimestamp(runtime.worker.latestReceiptAt)}
            </div>
          </div>
        </Card>

        <Card title="Receipt + Grading">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-400">Receipts sent</span> <span className="font-bold text-green-400">{runtime.receipts.sent}</span></div>
            <div><span className="text-gray-400">Receipts failed</span> <span className="font-bold text-red-400">{runtime.receipts.failed}</span></div>
            <div><span className="text-gray-400">Grading runs</span> <span className="font-bold">{runtime.grading.runCount}</span></div>
            <div><span className="text-gray-400">Last graded</span> <span className="font-bold">{runtime.grading.lastPicksGraded ?? 0}</span></div>
          </div>
          <div className="mt-4 space-y-1 text-xs text-gray-500">
            <div>Last sent receipt: {formatTimestamp(runtime.receipts.lastSentAt)}</div>
            <div>Last failed receipt: {formatTimestamp(runtime.receipts.lastFailedAt)}</div>
            <div>Last grading run: {formatTimestamp(runtime.grading.lastGradingRunAt)} ({runtime.grading.lastGradingRunStatus ?? 'unknown'})</div>
            <div>Last recap post: {formatTimestamp(runtime.grading.lastRecapPostAt)} {runtime.grading.lastRecapChannel ? `to ${runtime.grading.lastRecapChannel}` : ''}</div>
          </div>
        </Card>

        <Card title="Provider Health">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-400">Active</span> <span className="font-bold text-green-400">{runtime.providerSummary.active}</span></div>
            <div><span className="text-gray-400">Stale</span> <span className="font-bold text-yellow-400">{runtime.providerSummary.stale}</span></div>
            <div><span className="text-gray-400">Absent</span> <span className="font-bold text-red-400">{runtime.providerSummary.absent}</span></div>
            <div><span className="text-gray-400">Events (24h)</span> <span className="font-bold">{runtime.providerSummary.distinctEventsLast24h}</span></div>
          </div>
          <div className="mt-4 space-y-2 text-xs text-gray-500">
            <div>Ingestor status: {runtime.providerSummary.ingestorStatus}</div>
            <div>Latest live snapshot: {formatTimestamp(runtime.providerSummary.latestLiveSnapshotAt)}</div>
            <div>Alias review: {aliasReviewCounts.missingBookAliases} missing book / {aliasReviewCounts.missingMarketAliases} missing market</div>
            {runtime.deliveryTargets.map((target) => (
              <div key={target.target}>
                {target.target}: {target.recentSentCount} sent / {target.recentFailureCount} failed
              </div>
            ))}
          </div>
        </Card>

        <Card title="Provider Cycle Staging">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-400">Overall</span>
              <span className={`font-bold uppercase ${cycleStatusTone(runtime.providerCycleSummary.overallStatus)}`}>
                {runtime.providerCycleSummary.overallStatus}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-gray-400">Tracked lanes</span> <span className="font-bold">{runtime.providerCycleSummary.trackedLanes}</span></div>
              <div><span className="text-gray-400">Merged</span> <span className="font-bold text-green-400">{runtime.providerCycleSummary.mergedLanes}</span></div>
              <div><span className="text-gray-400">Blocked</span> <span className="font-bold text-yellow-400">{runtime.providerCycleSummary.blockedLanes}</span></div>
              <div><span className="text-gray-400">Failed</span> <span className="font-bold text-red-400">{runtime.providerCycleSummary.failedLanes}</span></div>
              <div><span className="text-gray-400">Stale gates</span> <span className="font-bold text-red-400">{runtime.providerCycleSummary.staleLanes}</span></div>
              <div><span className="text-gray-400">Proof required</span> <span className="font-bold">{runtime.providerCycleSummary.proofRequiredLanes}</span></div>
            </div>
          </div>
          <div className="mt-4 space-y-1 text-xs text-gray-500">
            <div>Staging truth only. Live offer freshness remains in Provider Health.</div>
            <div>Latest staged cycle snapshot: {formatTimestamp(runtime.providerCycleSummary.latestCycleSnapshotAt)}</div>
            <div>Latest cycle status update: {formatTimestamp(runtime.providerCycleSummary.latestUpdatedAt)}</div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="DB + Storage">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-400">Disk used</span> <span className="font-bold">{runtime.db.disk.usedGiB.toFixed(2)} / {runtime.db.disk.provisionedGiB.toFixed(0)} GiB</span></div>
            <div><span className="text-gray-400">Days to full</span> <span className={`font-bold ${diskTone(runtime.db.disk.alertStatus)}`}>{formatDaysToFull(runtime.db.disk.projectedDaysToFull)}</span></div>
            <div><span className="text-gray-400">Connections</span> <span className="font-bold">{runtime.db.connections.used} / {runtime.db.connections.max}</span></div>
            <div><span className="text-gray-400">Waiting locks</span> <span className={`font-bold ${runtime.db.locks.waiting > 0 ? 'text-red-400' : 'text-green-400'}`}>{runtime.db.locks.waiting}</span></div>
            <div><span className="text-gray-400">Long tx</span> <span className={`font-bold ${runtime.db.longTransactions.count > 0 ? 'text-red-400' : 'text-green-400'}`}>{runtime.db.longTransactions.count}</span></div>
            <div><span className="text-gray-400">Slow queries</span> <span className={`font-bold ${runtime.db.slowQueries.count > 0 ? 'text-red-400' : 'text-green-400'}`}>{runtime.db.slowQueries.count}</span></div>
            <div><span className="text-gray-400">WAL size</span> <span className="font-bold">{runtime.db.wal.sizeGiB.toFixed(2)} GiB</span></div>
            <div><span className="text-gray-400">WAL/day</span> <span className="font-bold">{runtime.db.wal.estimatedGrowthGiBPerDay.toFixed(2)} GiB</span></div>
          </div>
          <div className="mt-4 space-y-1 text-xs text-gray-500">
            <div>Observed: {formatTimestamp(runtime.db.disk.observedAt)}</div>
            <div>Archive mode: {runtime.db.wal.archiveMode} ({runtime.db.wal.archiveConfigured ? 'configured' : 'not configured'})</div>
            <div>Pending outbox max age: {runtime.observability.pendingOutboxAgeMaxMinutes != null ? `${runtime.observability.pendingOutboxAgeMaxMinutes}m` : '-'}</div>
            <div>Latest distribution run: {formatTimestamp(runtime.observability.latestDistributionRunAt)}</div>
          </div>
        </Card>

        <Card title="Backups + Top Growth">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-400">Last backup</span> <span className={`font-bold ${runtime.db.backups.lastBackupStatus === 'COMPLETED' ? 'text-green-400' : 'text-red-400'}`}>{runtime.db.backups.lastBackupStatus ?? 'unknown'}</span></div>
            <div><span className="text-gray-400">Restore points</span> <span className="font-bold">{runtime.db.backups.restorePointCount}</span></div>
            <div><span className="text-gray-400">PITR</span> <span className={`font-bold ${runtime.db.backups.pitrEnabled ? 'text-green-400' : 'text-yellow-400'}`}>{runtime.db.backups.pitrEnabled ? 'enabled' : 'disabled'}</span></div>
            <div><span className="text-gray-400">WAL-G</span> <span className={`font-bold ${runtime.db.backups.walGEnabled ? 'text-green-400' : 'text-red-400'}`}>{runtime.db.backups.walGEnabled ? 'enabled' : 'disabled'}</span></div>
          </div>
          <div className="mt-4 space-y-1 text-xs text-gray-500">
            <div>Last completed backup: {formatTimestamp(runtime.db.backups.lastBackupAt)}</div>
            {runtime.db.topGrowthSources.slice(0, 4).map((source) => (
              <div key={source.source}>
                {source.source}: {(source.totalBytes / 1024 / 1024 / 1024).toFixed(2)} GiB total / {(source.estimatedGrowthBytesPerDay / 1024 / 1024 / 1024).toFixed(2)} GiB per day
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {runtime.db.storageDomains.map((domain) => (
          <Card key={domain.name} title={`${domain.name === 'ingestion' ? 'Ingestion' : 'App'} Growth`}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-400">Current size</span> <span className="font-bold">{domain.totalGiB.toFixed(2)} GiB</span></div>
              <div><span className="text-gray-400">Growth/day</span> <span className="font-bold">{domain.estimatedGrowthGiBPerDay.toFixed(2)} GiB</span></div>
              <div><span className="text-gray-400">Days to full</span> <span className={`font-bold ${diskTone(domain.alertStatus)}`}>{formatDaysToFull(domain.daysToFull)}</span></div>
              <div><span className="text-gray-400">Status</span> <span className={`font-bold ${diskTone(domain.alertStatus)}`}>{domain.alertStatus}</span></div>
            </div>
            <div className="mt-4 space-y-1 text-xs text-gray-500">
              {domain.topGrowthSources.map((source) => (
                <div key={source.source}>
                  {source.source}: {(source.totalBytes / 1024 / 1024 / 1024).toFixed(2)} GiB total / {(source.estimatedGrowthBytesPerDay / 1024 / 1024 / 1024).toFixed(2)} GiB per day
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {data.exceptions.length > 0 && (
        <ExceptionPanel exceptions={data.exceptions} />
      )}

      <Card title="Operational Baseline">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 text-sm">
            <div className="font-medium text-gray-200">Normal</div>
            {runtime.baseline.normal.map((line) => (
              <div key={line} className="text-gray-400">{line}</div>
            ))}
          </div>
          <div className="space-y-2 text-sm">
            <div className="font-medium text-gray-200">Abnormal</div>
            {runtime.baseline.abnormal.map((line) => (
              <div key={line} className="text-gray-400">{line}</div>
            ))}
          </div>
        </div>
      </Card>

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
                : '-'}
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
