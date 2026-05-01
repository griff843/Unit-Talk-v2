import type { DashboardData, DashboardRuntimeData, LifecycleSignal, OperationalException, PickRow } from '@/lib/types';

export type OverviewTone = 'healthy' | 'warning' | 'critical' | 'neutral';
export type OverviewTrend = 'up' | 'down' | 'flat';

export interface OverviewStatCard {
  id: 'today-picks' | 'active-agents' | 'pipeline-lag' | 'api-health';
  label: string;
  tone: OverviewTone;
  value: number;
  unit?: string;
  secondaryValue?: number;
  secondaryLabel?: string;
  deltaLabel: string;
  trend: OverviewTrend;
}

export interface OverviewPipelineStage {
  id: 'ingest' | 'normalize' | 'grade' | 'promote' | 'publish';
  label: string;
  status: 'healthy' | 'warning' | 'critical' | 'idle';
  count: number;
  detail: string;
  warningCount: number;
  errorCount: number;
}

export interface OverviewFeedItem {
  id: string;
  badge: string;
  badgeTone: OverviewTone;
  submittedAt: string;
  submittedBy: string;
  market: string;
  selection: string;
  sport: string;
  lifecycleStatus: string;
  score: number | null;
}

export interface OverviewAlertItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  at: string;
}

export interface OverviewDashboardModel {
  statCards: OverviewStatCard[];
  pipelineStages: OverviewPipelineStage[];
  picksFeed: OverviewFeedItem[];
  alerts: OverviewAlertItem[];
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function countPicksBetween(picks: PickRow[], start: Date, end: Date) {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return picks.filter((pick) => {
    const submittedAt = Date.parse(pick.submittedAt);
    return Number.isFinite(submittedAt) && submittedAt >= startMs && submittedAt < endMs;
  }).length;
}

function resolveTrend(delta: number): OverviewTrend {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function countScoredPicks(picks: PickRow[]) {
  return picks.filter((pick) => pick.score !== null).length;
}

function countQualifiedPicks(picks: PickRow[]) {
  return picks.filter((pick) => pick.promotionStatus === 'qualified').length;
}

function countPublishedPicks(picks: PickRow[]) {
  return picks.filter((pick) => pick.deliveryStatus === 'delivered').length;
}

function countExceptionsByCategory(
  exceptions: OperationalException[],
  categories: OperationalException['category'][],
  severity: OperationalException['severity'],
) {
  return exceptions.filter((exception) => (
    categories.includes(exception.category) && exception.severity === severity
  )).length;
}

function averageLagMs(observedAt: string, runtime: DashboardRuntimeData) {
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) {
    return 0;
  }

  const timestamps = [
    runtime.worker.latestRunAt,
    runtime.worker.latestReceiptAt,
    runtime.providerSummary.latestLiveSnapshotAt,
    runtime.providerCycleSummary.latestUpdatedAt,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0, observedAtMs - value));

  if (timestamps.length === 0) {
    return 0;
  }

  return Math.round(timestamps.reduce((sum, value) => sum + value, 0) / timestamps.length);
}

function resolveApiHealth(signals: LifecycleSignal[]) {
  const broken = signals.filter((signal) => signal.status === 'BROKEN').length;
  const degraded = signals.filter((signal) => signal.status === 'DEGRADED').length;
  const healthy = signals.length - broken - degraded;

  if (broken >= 2 || healthy === 0) {
    return {
      tone: 'critical' as const,
      label: 'Down',
      healthyCount: healthy,
      totalCount: signals.length,
    };
  }

  if (broken > 0 || degraded > 0) {
    return {
      tone: 'warning' as const,
      label: 'Degraded',
      healthyCount: healthy,
      totalCount: signals.length,
    };
  }

  return {
    tone: 'healthy' as const,
    label: 'Healthy',
    healthyCount: healthy,
    totalCount: signals.length,
  };
}

function resolveActiveAgentSummary(runtime: DashboardRuntimeData, apiHealthTone: OverviewTone) {
  const agents = [
    apiHealthTone === 'healthy',
    runtime.worker.drainState !== 'paused' && runtime.worker.drainState !== 'unknown',
    runtime.providerSummary.ingestorStatus === 'healthy' || runtime.providerSummary.ingestorStatus === 'ok',
    ...runtime.deliveryTargets.map((target) => target.healthy),
  ];

  const healthyCount = agents.filter(Boolean).length;
  return {
    healthyCount,
    totalCount: agents.length,
    degradedCount: agents.length - healthyCount,
    tone:
      healthyCount === agents.length
        ? 'healthy'
        : healthyCount === 0
          ? 'critical'
          : 'warning',
  } as const;
}

function resolvePipelineStages(data: DashboardData, runtime: DashboardRuntimeData): OverviewPipelineStage[] {
  const scoringSignal = data.signals.find((signal) => signal.signal === 'scoring');
  const promotionSignal = data.signals.find((signal) => signal.signal === 'promotion');
  const publishSignal = data.signals.find((signal) => signal.signal === 'discord_delivery');
  const normalizedTracked = runtime.providerSummary.active + runtime.providerSummary.stale + runtime.providerSummary.absent;
  const ingestErrors = runtime.providerSummary.absent;
  const normalizeWarnings = runtime.providerSummary.stale;
  const publishWarnings = runtime.outbox.failed;
  const publishErrors = runtime.outbox.deadLetter;

  return [
    {
      id: 'ingest',
      label: 'Ingest',
      status:
        ingestErrors > 0
          ? 'critical'
          : runtime.providerSummary.active > 0
            ? 'healthy'
            : 'idle',
      count: runtime.providerSummary.active,
      detail: `${runtime.providerSummary.active} active providers`,
      warningCount: runtime.providerSummary.stale,
      errorCount: ingestErrors,
    },
    {
      id: 'normalize',
      label: 'Normalize',
      status:
        ingestErrors > 0
          ? 'critical'
          : normalizeWarnings > 0
            ? 'warning'
            : normalizedTracked > 0
              ? 'healthy'
              : 'idle',
      count: normalizedTracked,
      detail: `${normalizedTracked} lanes normalized`,
      warningCount: normalizeWarnings,
      errorCount: ingestErrors,
    },
    {
      id: 'grade',
      label: 'Grade',
      status: scoringSignal ? stageStatusFromSignal(scoringSignal.status) : 'idle',
      count: countScoredPicks(data.picks),
      detail: scoringSignal?.detail ?? 'Awaiting scored picks',
      warningCount: countExceptionsByCategory(data.exceptions, ['scoring'], 'warning'),
      errorCount: countExceptionsByCategory(data.exceptions, ['scoring'], 'critical'),
    },
    {
      id: 'promote',
      label: 'Promote',
      status: promotionSignal ? stageStatusFromSignal(promotionSignal.status) : 'idle',
      count: countQualifiedPicks(data.picks),
      detail: promotionSignal?.detail ?? 'Awaiting promotion decisions',
      warningCount: countExceptionsByCategory(data.exceptions, ['lifecycle'], 'warning'),
      errorCount: countExceptionsByCategory(data.exceptions, ['lifecycle'], 'critical'),
    },
    {
      id: 'publish',
      label: 'Publish',
      status:
        publishErrors > 0
          ? 'critical'
          : publishWarnings > 0 || publishSignal?.status === 'DEGRADED'
            ? 'warning'
            : publishSignal?.status === 'WORKING'
              ? 'healthy'
              : 'idle',
      count: countPublishedPicks(data.picks),
      detail: publishSignal?.detail ?? 'Awaiting delivery receipts',
      warningCount: publishWarnings,
      errorCount: publishErrors,
    },
  ];
}

function stageStatusFromSignal(status: LifecycleSignal['status']): OverviewPipelineStage['status'] {
  switch (status) {
    case 'WORKING':
      return 'healthy';
    case 'DEGRADED':
      return 'warning';
    case 'BROKEN':
      return 'critical';
  }
}

function resolveFeedBadge(pick: PickRow) {
  if (pick.score !== null && pick.score >= 85) {
    return { badge: 'Prime', badgeTone: 'healthy' as const };
  }
  if (pick.promotionStatus === 'qualified') {
    return { badge: 'Best Bet', badgeTone: 'healthy' as const };
  }
  if (pick.score !== null && pick.score >= 70) {
    return { badge: 'Live', badgeTone: 'warning' as const };
  }
  return { badge: 'Watch', badgeTone: 'neutral' as const };
}

function buildPicksFeed(picks: PickRow[]): OverviewFeedItem[] {
  return [...picks]
    .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))
    .slice(0, 10)
    .map((pick) => {
      const badge = resolveFeedBadge(pick);

      return {
        id: pick.id,
        badge: badge.badge,
        badgeTone: badge.badgeTone,
        submittedAt: pick.submittedAt,
        submittedBy: pick.submitter,
        market: pick.pickDetails.market,
        selection: pick.pickDetails.selection,
        sport: pick.sport ?? 'Board',
        lifecycleStatus: pick.lifecycleStatus,
        score: pick.score,
      };
    });
}

function buildAlerts(data: DashboardData, runtime: DashboardRuntimeData): OverviewAlertItem[] {
  const signalAlerts = data.signals
    .filter((signal) => signal.status !== 'WORKING')
    .map((signal) => ({
      id: `signal-${signal.signal}`,
      severity: signal.status === 'BROKEN' ? 'critical' as const : 'warning' as const,
      title: signal.signal.replaceAll('_', ' '),
      detail: signal.detail,
      at: data.observedAt,
    }));

  const exceptionAlerts = data.exceptions.map((exception) => ({
    id: exception.id,
    severity: exception.severity === 'critical' ? 'critical' as const : 'warning' as const,
    title: exception.title,
    detail: exception.detail,
    at: data.observedAt,
  }));

  const deliveryAlerts = runtime.deliveryTargets
    .filter((target) => !target.healthy || target.recentFailureCount > 0)
    .map((target) => ({
      id: `target-${target.target}`,
      severity: target.recentFailureCount > 0 ? 'warning' as const : 'info' as const,
      title: `${target.target} lane`,
      detail: `${target.recentSentCount} sent, ${target.recentFailureCount} failed recently`,
      at: target.latestSentAt ?? data.observedAt,
    }));

  return [...exceptionAlerts, ...signalAlerts, ...deliveryAlerts]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 12);
}

export function buildOverviewDashboardModel(
  data: DashboardData,
  runtime: DashboardRuntimeData,
): OverviewDashboardModel {
  const now = new Date(data.observedAt);
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(todayStart.getDate() - 1);

  const todayCount = countPicksBetween(data.picks, todayStart, now);
  const yesterdayCount = countPicksBetween(data.picks, yesterdayStart, todayStart);
  const picksDelta = todayCount - yesterdayCount;
  const pipelineLag = averageLagMs(data.observedAt, runtime);
  const apiHealth = resolveApiHealth(data.signals);
  const activeAgents = resolveActiveAgentSummary(runtime, apiHealth.tone);
  const lagTrend = pipelineLag > 300_000 ? 'down' : pipelineLag > 60_000 ? 'flat' : 'up';

  return {
    statCards: [
      {
        id: 'today-picks',
        label: "Today's Picks",
        tone: picksDelta >= 0 ? 'healthy' : 'warning',
        value: todayCount,
        deltaLabel:
          picksDelta === 0
            ? 'Flat vs yesterday'
            : `${picksDelta > 0 ? '+' : ''}${picksDelta} vs yesterday`,
        trend: resolveTrend(picksDelta),
      },
      {
        id: 'active-agents',
        label: 'Active Agents',
        tone: activeAgents.tone,
        value: activeAgents.healthyCount,
        secondaryValue: activeAgents.totalCount,
        secondaryLabel: 'healthy',
        deltaLabel:
          activeAgents.degradedCount === 0
            ? 'All lanes healthy'
            : `${activeAgents.degradedCount} lane${activeAgents.degradedCount === 1 ? '' : 's'} degraded`,
        trend: activeAgents.degradedCount === 0 ? 'up' : 'flat',
      },
      {
        id: 'pipeline-lag',
        label: 'Pipeline Lag Avg',
        tone: lagTrend === 'down' ? 'critical' : lagTrend === 'flat' ? 'warning' : 'healthy',
        value: pipelineLag,
        unit: 'ms',
        deltaLabel:
          lagTrend === 'down'
            ? 'Backlog building'
            : lagTrend === 'flat'
              ? 'Stable latency'
              : 'Fresh cycle data',
        trend: lagTrend,
      },
      {
        id: 'api-health',
        label: 'API Health',
        tone: apiHealth.tone,
        value: apiHealth.healthyCount,
        secondaryValue: apiHealth.totalCount,
        secondaryLabel: apiHealth.label,
        deltaLabel: `${apiHealth.label} signal set`,
        trend: apiHealth.tone === 'healthy' ? 'up' : apiHealth.tone === 'warning' ? 'flat' : 'down',
      },
    ],
    pipelineStages: resolvePipelineStages(data, runtime),
    picksFeed: buildPicksFeed(data.picks),
    alerts: buildAlerts(data, runtime),
  };
}
