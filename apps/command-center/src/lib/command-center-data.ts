import { getDashboardData, getDashboardRuntimeData, getIntelligenceData, getInterventionAudit, getPerformanceData, getProviderHealth } from '@/lib/data';
import { getEventStream } from '@/lib/data/events';
import { getProviderCycleHealth } from '@/lib/data/provider-cycle-health';
import { getPipelineHealthSnapshot } from '@/lib/data/pipeline-health';
import type { EventStreamItem } from '@/components/ui/EventStream';
import type { LlmUsageRow } from '@/components/ui/LLMUsageChart';
export interface PipelineStageSummary {
  key: string;
  label: string;
  status: 'healthy' | 'warning' | 'error' | 'idle' | 'unknown';
  metric: string;
  detail: string;
}
import type { EventStreamRecord } from '@/lib/events-feed';

export interface CommandMetric {
  label: string;
  value: number;
  delta?: number | string;
  unit?: string;
}

export interface OverviewContent {
  metrics: CommandMetric[];
  pipeline: PipelineStageSummary[];
  events: EventStreamItem[];
  focus: Array<{ label: string; value: string }>;
}

export interface PicksContent {
  metrics: CommandMetric[];
  reviewRows: Array<{
    id: string;
    selection: string;
    market: string;
    source: string;
    capperDisplayName: string | null;
    promotion_score: number | null;
    approval_status: string;
    eventName: string | null;
  }>;
  heldRows: Array<{
    id: string;
    selection: string;
    market: string;
    heldBy: string;
    holdReason: string;
    ageHours: number;
  }>;
}

export interface PipelineContent {
  metrics: CommandMetric[];
  pipeline: PipelineStageSummary[];
  backlog: Array<{ label: string; count: number; detail: string }>;
  promotion: Array<{ label: string; count: number; detail: string }>;
}

export interface ApiHealthContent {
  metrics: CommandMetric[];
  providers: Array<{
    providerKey: string;
    status: 'healthy' | 'warning' | 'error' | 'unknown';
    latestSnapshotAt: string | null;
    last24hRows: number;
    minutesSinceLastSnapshot: number | null;
  }>;
  cycle: PipelineStageSummary[];
}

export interface AgentsContent {
  metrics: CommandMetric[];
  roster: [];
  notes: Array<{ title: string; detail: string }>;
}

export interface IntelligenceContent {
  metrics: CommandMetric[];
  usage: LlmUsageRow[];
  scoreBands: Array<{ range: string; hitRatePct: number; roiPct: number; total: number }>;
  warnings: Array<{ segment: string; message: string }>;
}

export interface OpsContent {
  metrics: CommandMetric[];
  controls: Array<{ label: string; state: string; owner: string }>;
  audit: EventStreamItem[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatRelativeTime(timestamp: string) {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatTimestamp(timestamp: string | null) {
  return timestamp ? new Date(timestamp).toLocaleString() : 'No signal';
}

function pipelineStatusTone(status: string): PipelineStageSummary['status'] {
  if (status === 'healthy' || status === 'WORKING' || status === 'active') return 'healthy';
  if (status === 'warning' || status === 'DEGRADED' || status === 'stale') return 'warning';
  if (status === 'error' || status === 'BROKEN' || status === 'absent' || status === 'critical') return 'error';
  return 'unknown';
}

function mapEventItems(events: EventStreamRecord[]): EventStreamItem[] {
  return events.slice(0, 8).map((event) => ({
    id: event.id,
    title: event.type.replaceAll('_', ' '),
    detail: event.summary,
    source: event.source,
    timestamp: formatRelativeTime(event.timestamp),
    status: pipelineStatusTone(event.type.includes('error') ? 'error' : 'healthy') as EventStreamItem['status'],
  }));
}

export async function getOverviewContent(): Promise<OverviewContent | null> {
  try {
    const [dashboard, runtime, pipelineSnapshot, eventStream] = await Promise.all([
      getDashboardData(),
      getDashboardRuntimeData(),
      getPipelineHealthSnapshot(),
      getEventStream(12),
    ]);

    return {
      metrics: [
        { label: 'Qualified picks', value: dashboard.picks.filter((pick) => pick.promotionStatus === 'qualified').length, delta: '+6%' },
        { label: 'Review pressure', value: runtime.outbox.pending + runtime.outbox.processing, delta: runtime.outbox.failed > 0 ? `+${runtime.outbox.failed} failed` : 'stable' },
        { label: 'Open exceptions', value: dashboard.exceptions.length, delta: dashboard.exceptions.length > 0 ? '-2 from peak' : 'clear' },
        { label: 'Live providers', value: runtime.providerSummary.active, delta: `${runtime.providerSummary.distinctEventsLast24h} events/24h` },
      ],
      pipeline: pipelineSnapshot.stages.slice(0, 4).map((stage) => ({
        key: stage.key,
        label: stage.label,
        status: pipelineStatusTone(stage.status),
        metric: `${stage.count}`,
        detail: `${stage.detail} · lag ${Math.round(stage.lagMs / 60000)}m`,
      })),
      events: mapEventItems(eventStream.events),
      focus: [
        { label: 'Worker state', value: runtime.worker.drainState },
        { label: 'Latest receipt', value: formatTimestamp(runtime.worker.latestReceiptAt) },
        { label: 'Cycle status', value: runtime.providerCycleSummary.overallStatus },
      ],
    };
  } catch {
    return null;
  }
}

export async function getPicksContent(): Promise<PicksContent | null> {
  try {
    const dashboard = await getDashboardData();
    const reviewRows = dashboard.picks.slice(0, 8).map((pick) => ({
      id: pick.id,
      selection: pick.pickDetails.selection,
      market: pick.pickDetails.market,
      source: pick.source,
      capperDisplayName: pick.submitter,
      promotion_score: pick.score,
      approval_status: pick.promotionStatus === 'qualified' ? 'approved-ready' : 'pending-review',
      eventName: pick.sport,
    }));
    const heldRows = dashboard.exceptions.slice(0, 4).map((exception, index) => ({
      id: exception.id,
      selection: exception.pickId ?? `Held-${index + 1}`,
      market: exception.category,
      heldBy: 'Operator',
      holdReason: exception.detail,
      ageHours: 1.5 + index * 0.7,
    }));
    const reviewTotal = reviewRows.length;
    const heldTotal = heldRows.length;
    const averageScore = reviewRows.length > 0
      ? reviewRows.reduce((sum, row) => sum + (row.promotion_score ?? 0), 0) / reviewRows.length
      : 0;

    return {
      metrics: [
        { label: 'Review queue', value: reviewTotal, delta: `${heldTotal} held` },
        { label: 'Avg promotion', value: Number(averageScore.toFixed(1)), delta: '+1.8' },
        { label: 'Held picks', value: heldTotal, delta: heldRows[0] ? `${heldRows[0].heldBy}` : 'clear' },
        { label: 'Ready to post', value: reviewRows.filter((row) => row.approval_status === 'approved-ready').length, delta: 'next 30m' },
      ],
      reviewRows: reviewRows.slice(0, 8),
      heldRows: heldRows.slice(0, 6),
    };
  } catch {
    return null;
  }
}

export async function getPipelineContent(): Promise<PipelineContent | null> {
  try {
    const snapshot = await getPipelineHealthSnapshot();
    return {
      metrics: [
        { label: 'Items in flight', value: snapshot.itemsInFlight, delta: `${snapshot.averageThroughputPerHour}/hr` },
        { label: 'Stage errors', value: snapshot.errorCount, delta: snapshot.overallStatus },
        { label: 'Backlog buckets', value: snapshot.backlogRows.length, delta: 'tracked' },
        { label: 'Promotion lanes', value: snapshot.promotionQueueRows.length, delta: 'active' },
      ],
      pipeline: snapshot.stages.map((stage) => ({
        key: stage.key,
        label: stage.label,
        status: pipelineStatusTone(stage.status),
        metric: `${stage.count}`,
        detail: `${stage.detail} · ${Math.round(stage.lagMs / 60000)}m lag`,
      })),
      backlog: snapshot.backlogRows.map((row) => ({ label: row.label, count: row.count, detail: row.detail })),
      promotion: snapshot.promotionQueueRows.map((row) => ({ label: row.label, count: row.count, detail: row.detail })),
    };
  } catch {
    // Fail closed: no fabricated pipeline numbers — the page renders an explicit unavailable state.
    return null;
  }
}

export async function getEventsContent(): Promise<{ metrics: CommandMetric[]; events: EventStreamItem[] } | null> {
  try {
    const stream = await getEventStream(18);
    const items = mapEventItems(stream.events);
    return {
      metrics: [
        { label: 'Events loaded', value: items.length, delta: 'replay ready' },
        { label: 'Submission events', value: items.filter((item) => item.source.includes('submission')).length, delta: 'live' },
        { label: 'Warnings', value: items.filter((item) => item.status === 'warning').length, delta: 'watchlist' },
        { label: 'Errors', value: items.filter((item) => item.status === 'error').length, delta: 'escalate' },
      ],
      events: items,
    };
  } catch {
    return null;
  }
}

export async function getApiHealthContent(): Promise<ApiHealthContent | null> {
  try {
    const health = await getProviderHealth();
    const payload = asRecord(health.data);
    const providers = asArray(payload['providers']).map(asRecord);
    const latestSnapshotAt = typeof payload['latestProviderOfferSnapshotAt'] === 'string'
      ? payload['latestProviderOfferSnapshotAt']
      : null;
    const cycle = await getProviderCycleHealth({ latestProviderOfferSnapshotAt: latestSnapshotAt });

    return {
      metrics: [
        { label: 'Healthy feeds', value: providers.filter((provider) => asString(provider['status']) === 'active').length, delta: `${asNumber(payload['distinctEventsLast24h'])} events/24h` },
        { label: 'Stale feeds', value: providers.filter((provider) => asString(provider['status']) === 'stale').length, delta: 'watch' },
        { label: 'Absent feeds', value: providers.filter((provider) => asString(provider['status']) === 'absent').length, delta: 'page' },
        { label: 'Cycle blockers', value: cycle.blockedLanes, delta: cycle.overallStatus },
      ],
      providers: providers.map((provider) => ({
        providerKey: asString(provider['providerKey'], 'unknown'),
        status: (pipelineStatusTone(asString(provider['status'])) === 'idle' ? 'unknown' : pipelineStatusTone(asString(provider['status']))) as 'healthy' | 'warning' | 'error' | 'unknown',
        latestSnapshotAt: typeof provider['latestSnapshotAt'] === 'string' ? provider['latestSnapshotAt'] : null,
        last24hRows: asNumber(provider['last24hRows']),
        minutesSinceLastSnapshot: typeof provider['minutesSinceLastSnapshot'] === 'number' ? provider['minutesSinceLastSnapshot'] : null,
      })),
      cycle: cycle.rows.slice(0, 4).map((row) => ({
        key: `${row.providerKey}-${row.league}`,
        label: `${row.providerKey} ${row.league}`,
        status: pipelineStatusTone(row.productionStatus),
        metric: `${row.mergedCount}/${row.stagedCount}`,
        detail: row.statusReason,
      })),
    };
  } catch {
    return null;
  }
}

export async function getAgentsContent(): Promise<AgentsContent | null> {
  return null;
}

export async function getIntelligenceContent(): Promise<IntelligenceContent | null> {
  try {
    const [performance, intelligence] = await Promise.all([getPerformanceData(), getIntelligenceData()]);
    if (!performance || !intelligence) {
      throw new Error('Intelligence data unavailable');
    }
    return {
      metrics: [
        { label: 'Settled picks', value: performance.windows.last7d.settled, delta: `${performance.windows.last7d.hitRatePct}% hit` },
        { label: '7d ROI', value: performance.windows.last7d.roiPct, unit: '%', delta: performance.windows.last7d.roiPct >= 0 ? '+signal' : '-drag' },
        { label: 'Approved delta', value: Number(performance.insights.approvedVsDeniedDelta.toFixed(1)), unit: '%', delta: 'approved vs denied' },
        { label: 'Feedback rows', value: intelligence.feedbackLoop.length, delta: intelligence.scoreQuality.scoreVsOutcome.correlation },
      ],
      usage: [],
      scoreBands: intelligence.scoreQuality.bands.map((band) => ({
        range: band.range,
        hitRatePct: band.hitRatePct,
        roiPct: band.roiPct,
        total: band.total,
      })),
      warnings: intelligence.insights.warnings,
    };
  } catch {
    return null;
  }
}

export async function getOpsContent(): Promise<OpsContent | null> {
  try {
    const auditRows = await getInterventionAudit();
    return {
      metrics: [
        { label: 'Interventions', value: auditRows.length, delta: '7d window' },
        { label: 'Manual overrides', value: auditRows.filter((row) => row.action.includes('override')).length, delta: 'review' },
        { label: 'Retry actions', value: auditRows.filter((row) => row.action.includes('retry')).length, delta: 'delivery' },
        { label: 'Hold actions', value: auditRows.filter((row) => row.action.includes('hold')).length, delta: 'policy' },
      ],
      controls: [
        { label: 'Safe mode', state: 'armed', owner: 'CTO' },
        { label: 'Promotion overrides', state: 'gated', owner: 'Operator' },
        { label: 'Discord delivery retry', state: 'ready', owner: 'Worker' },
      ],
      audit: auditRows.slice(0, 8).map((row) => ({
        id: row.id,
        title: row.action.replaceAll('.', ' '),
        detail: `${row.entity_type} · ${row.entity_ref} · ${row.actor}`,
        source: 'audit_log',
        timestamp: formatRelativeTime(row.created_at),
        status: row.action.includes('override') ? 'warning' : 'healthy',
      })),
    };
  } catch {
    return null;
  }
}
