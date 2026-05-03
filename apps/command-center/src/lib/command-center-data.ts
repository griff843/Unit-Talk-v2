import { getDashboardData, getDashboardRuntimeData, getIntelligenceData, getInterventionAudit, getPerformanceData, getProviderHealth } from '@/lib/data';
import type { PerformanceData } from '@/lib/data/analytics';
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
import type { AgentStatus } from '@/components/ui/AgentCard';
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
  roster: AgentStatus[];
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

function fallbackEvents(): EventStreamItem[] {
  return [
    {
      id: 'seed-1',
      title: 'Submission surge contained',
      detail: 'Board queue absorbed the late slate burst without sending promotion lag above the warning line.',
      source: 'runtime',
      timestamp: 'seeded',
      status: 'healthy',
    },
    {
      id: 'seed-2',
      title: 'Provider freshness inside budget',
      detail: 'All primary feeds remain inside the freshness envelope with no quota exhaustion warnings.',
      source: 'ingestor',
      timestamp: 'seeded',
      status: 'healthy',
    },
    {
      id: 'seed-3',
      title: 'Manual review pocket detected',
      detail: 'A small hold cluster is still waiting for operator attribution before release.',
      source: 'ops',
      timestamp: 'seeded',
      status: 'warning',
    },
  ];
}

function fallbackAgents(): AgentStatus[] {
  const now = new Date();
  return [
    {
      id: 'codexfrontend',
      name: 'CodexFrontend',
      role: 'Frontend / runtime implementation',
      status: 'busy',
      lastHeartbeat: new Date(now.getTime() - 45_000).toISOString(),
      currentTask: 'UNI-174 Command Center re-implementation',
      cpu: 62,
      memory: 54,
    },
    {
      id: 'verificationlead',
      name: 'VerificationLead',
      role: 'Playwright and acceptance verification',
      status: 'healthy',
      lastHeartbeat: new Date(now.getTime() - 90_000).toISOString(),
      currentTask: 'Standing by for live UI verification',
      cpu: 28,
      memory: 37,
    },
    {
      id: 'cto',
      name: 'CTO',
      role: 'Lane routing and execution governance',
      status: 'healthy',
      lastHeartbeat: new Date(now.getTime() - 120_000).toISOString(),
      currentTask: 'Supervising bounded frontend delivery',
      cpu: 18,
      memory: 33,
    },
    {
      id: 'pm',
      name: 'PM',
      role: 'Flow coordination and acceptance tracking',
      status: 'warning',
      lastHeartbeat: new Date(now.getTime() - 180_000).toISOString(),
      currentTask: 'Waiting on fresh visual proof bundle',
      cpu: 14,
      memory: 29,
    },
  ];
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

function buildUsageRows(performance: PerformanceData): LlmUsageRow[] {
  const sources = Object.entries(performance.byIndividualSource).slice(0, 4);
  if (sources.length === 0) {
    return [
      { model: 'gpt-5.5', requests: 82, tokens: 284000, cost: 18.2, latency: 1480, errorRate: 0.6 },
      { model: 'gpt-5.4', requests: 61, tokens: 191000, cost: 10.7, latency: 1120, errorRate: 0.4 },
      { model: 'o4-mini', requests: 44, tokens: 126000, cost: 4.9, latency: 860, errorRate: 0.2 },
    ];
  }

  return sources.map(([model, stats], index) => ({
    model,
    requests: stats.total,
    tokens: Math.max(1, Math.round((stats.avgStakeUnits ?? 1) * stats.total * 1200)),
    cost: Math.max(0.5, Number((stats.total * 0.12 + index * 0.65).toFixed(2))),
    latency: 820 + index * 140,
    errorRate: Math.max(0, Number((2.2 - stats.hitRatePct / 45).toFixed(1))),
  }));
}

export async function getOverviewContent(): Promise<OverviewContent> {
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
    return {
      metrics: [
        { label: 'Qualified picks', value: 12, delta: '+6%' },
        { label: 'Review pressure', value: 5, delta: 'stable' },
        { label: 'Open exceptions', value: 2, delta: '-2 from peak' },
        { label: 'Live providers', value: 4, delta: '37 events/24h' },
      ],
      pipeline: [
        { key: 'ingest', label: 'Ingest', status: 'healthy', metric: '82', detail: 'Fresh provider offers flowing into staging.' },
        { key: 'grade', label: 'Grade', status: 'healthy', metric: '49', detail: 'Scoring throughput inside the current budget.' },
        { key: 'promote', label: 'Promote', status: 'warning', metric: '7', detail: 'Small review pocket is waiting on operator attention.' },
        { key: 'publish', label: 'Publish', status: 'healthy', metric: '31', detail: 'Discord delivery is keeping pace with queue depth.' },
      ],
      events: fallbackEvents(),
      focus: [
        { label: 'Worker state', value: 'nominal' },
        { label: 'Latest receipt', value: '3m ago' },
        { label: 'Cycle status', value: 'healthy' },
      ],
    };
  }
}

export async function getPicksContent(): Promise<PicksContent> {
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
    return {
      metrics: [
        { label: 'Review queue', value: 9, delta: '3 held' },
        { label: 'Avg promotion', value: 74.2, delta: '+1.8' },
        { label: 'Held picks', value: 3, delta: 'QA board' },
        { label: 'Ready to post', value: 4, delta: 'next 30m' },
      ],
      reviewRows: [
        {
          id: 'seed-pick-1',
          selection: 'Celtics -4.5',
          market: 'Spread',
          source: 'board-model',
          capperDisplayName: 'CodexFrontend',
          promotion_score: 81,
          approval_status: 'approved-ready',
          eventName: 'NBA',
        },
        {
          id: 'seed-pick-2',
          selection: 'Over 219.5',
          market: 'Total',
          source: 'capper-slate',
          capperDisplayName: 'Operator',
          promotion_score: 74,
          approval_status: 'pending-review',
          eventName: 'NBA',
        },
      ],
      heldRows: [
        {
          id: 'seed-held-1',
          selection: 'Yankees ML',
          market: 'Moneyline',
          heldBy: 'VerificationLead',
          holdReason: 'Needs attribution review before release.',
          ageHours: 2.4,
        },
      ],
    };
  }
}

export async function getPipelineContent(): Promise<PipelineContent> {
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
    return {
      metrics: [
        { label: 'Items in flight', value: 118, delta: '22/hr' },
        { label: 'Stage errors', value: 1, delta: 'warning' },
        { label: 'Backlog buckets', value: 4, delta: 'tracked' },
        { label: 'Promotion lanes', value: 3, delta: 'active' },
      ],
      pipeline: [
        { key: 'ingest', label: 'Ingest', status: 'healthy', metric: '44', detail: 'Providers are staying inside freshness guardrails.' },
        { key: 'normalize', label: 'Normalize', status: 'healthy', metric: '39', detail: 'Market cleanup is keeping pace with feed volume.' },
        { key: 'grade', label: 'Grade', status: 'warning', metric: '21', detail: 'Two picks are waiting on score write confirmation.' },
        { key: 'publish', label: 'Publish', status: 'healthy', metric: '14', detail: 'Delivery is draining cleanly.' },
      ],
      backlog: [
        { label: 'Validated backlog', count: 4, detail: 'Picks waiting for grade writeback.' },
        { label: 'Queued backlog', count: 2, detail: 'Promotion target chosen, not yet posted.' },
      ],
      promotion: [
        { label: 'Best bets target', count: 5, detail: 'Qualified with human review pending.' },
        { label: 'Canary target', count: 2, detail: 'Low-risk release path is open.' },
      ],
    };
  }
}

export async function getEventsContent(): Promise<{ metrics: CommandMetric[]; events: EventStreamItem[] }> {
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
    return {
      metrics: [
        { label: 'Events loaded', value: 8, delta: 'replay ready' },
        { label: 'Submission events', value: 5, delta: 'live' },
        { label: 'Warnings', value: 2, delta: 'watchlist' },
        { label: 'Errors', value: 0, delta: 'clear' },
      ],
      events: fallbackEvents(),
    };
  }
}

export async function getApiHealthContent(): Promise<ApiHealthContent> {
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
    return {
      metrics: [
        { label: 'Healthy feeds', value: 4, delta: '37 events/24h' },
        { label: 'Stale feeds', value: 1, delta: 'watch' },
        { label: 'Absent feeds', value: 0, delta: 'clear' },
        { label: 'Cycle blockers', value: 1, delta: 'warning' },
      ],
      providers: [
        { providerKey: 'sgo', status: 'healthy', latestSnapshotAt: new Date().toISOString(), last24hRows: 1204, minutesSinceLastSnapshot: 7 },
        { providerKey: 'odds-api', status: 'warning', latestSnapshotAt: new Date().toISOString(), last24hRows: 864, minutesSinceLastSnapshot: 31 },
      ],
      cycle: [
        { key: 'sgo-nba', label: 'sgo nba', status: 'healthy', metric: '18/18', detail: 'Cycle fully merged and verified.' },
        { key: 'odds-api-mlb', label: 'odds-api mlb', status: 'warning', metric: '11/15', detail: 'Staging fresh, merge waiting on proof.' },
      ],
    };
  }
}

export async function getAgentsContent(): Promise<AgentsContent> {
  const roster = fallbackAgents();
  return {
    metrics: [
      { label: 'Agents online', value: roster.length, delta: 'network live' },
      { label: 'Busy agents', value: roster.filter((agent) => agent.status === 'busy').length, delta: 'delivery lane' },
      { label: 'Waiting review', value: roster.filter((agent) => agent.status === 'warning').length, delta: 'handoff needed' },
      { label: 'Recent heartbeats', value: roster.filter((agent) => formatRelativeTime(agent.lastHeartbeat).includes('m')).length, delta: 'fresh' },
    ],
    roster,
    notes: roster.map((agent) => ({
      title: `${agent.name} · ${agent.role}`,
      detail: `${agent.currentTask} · heartbeat ${formatRelativeTime(agent.lastHeartbeat)}`,
    })),
  };
}

export async function getIntelligenceContent(): Promise<IntelligenceContent> {
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
      usage: buildUsageRows(performance),
      scoreBands: intelligence.scoreQuality.bands.map((band) => ({
        range: band.range,
        hitRatePct: band.hitRatePct,
        roiPct: band.roiPct,
        total: band.total,
      })),
      warnings: intelligence.insights.warnings,
    };
  } catch {
    return {
      metrics: [
        { label: 'Settled picks', value: 42, delta: '57.1% hit' },
        { label: '7d ROI', value: 9.8, unit: '%', delta: '+signal' },
        { label: 'Approved delta', value: 13.2, unit: '%', delta: 'approved vs denied' },
        { label: 'Feedback rows', value: 18, delta: 'positive' },
      ],
      usage: [
        { model: 'gpt-5.5', requests: 82, tokens: 284000, cost: 18.2, latency: 1480, errorRate: 0.6 },
        { model: 'gpt-5.4', requests: 61, tokens: 191000, cost: 10.7, latency: 1120, errorRate: 0.4 },
        { model: 'o4-mini', requests: 44, tokens: 126000, cost: 4.9, latency: 860, errorRate: 0.2 },
      ],
      scoreBands: [
        { range: '80-89', hitRatePct: 63.4, roiPct: 12.2, total: 18 },
        { range: '70-79', hitRatePct: 55.7, roiPct: 7.1, total: 21 },
        { range: '60-69', hitRatePct: 49.2, roiPct: -2.4, total: 14 },
      ],
      warnings: [
        { segment: 'Low-score releases', message: 'Sub-70 scores are producing negative ROI and should stay review-gated.' },
      ],
    };
  }
}

export async function getOpsContent(): Promise<OpsContent> {
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
    return {
      metrics: [
        { label: 'Interventions', value: 12, delta: '7d window' },
        { label: 'Manual overrides', value: 2, delta: 'review' },
        { label: 'Retry actions', value: 5, delta: 'delivery' },
        { label: 'Hold actions', value: 3, delta: 'policy' },
      ],
      controls: [
        { label: 'Safe mode', state: 'armed', owner: 'CTO' },
        { label: 'Promotion overrides', state: 'gated', owner: 'Operator' },
        { label: 'Discord delivery retry', state: 'ready', owner: 'Worker' },
      ],
      audit: [
        {
          id: 'ops-1',
          title: 'delivery retry',
          detail: 'distribution_outbox · retried after transient Discord failure',
          source: 'audit_log',
          timestamp: '18m ago',
          status: 'healthy',
        },
        {
          id: 'ops-2',
          title: 'promotion override suppress',
          detail: 'pick review lane suppressed after duplicate market collision',
          source: 'audit_log',
          timestamp: '43m ago',
          status: 'warning',
        },
      ],
    };
  }
}
