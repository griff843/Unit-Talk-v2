import { getIntelligenceData, getPerformanceData } from '@/lib/data';
import { getEventStream } from '@/lib/data/events';
import { getPipelineHealthSnapshot } from '@/lib/data/pipeline-health';
import type { EventStreamItem } from '@/components/ui/EventStream';
import type { EventStreamRecord } from '@/lib/events-feed';
import type { LlmUsageRow } from '@/components/ui/LLMUsageChart';

export interface PipelineStageSummary {
  key: string;
  label: string;
  status: 'healthy' | 'warning' | 'error' | 'idle' | 'unknown';
  metric: string;
  detail: string;
}

export interface CommandMetric {
  label: string;
  value: number;
  delta?: number | string;
  unit?: string;
}

export interface PipelineContent {
  metrics: CommandMetric[];
  pipeline: PipelineStageSummary[];
  backlog: Array<{ label: string; count: number; detail: string }>;
  promotion: Array<{ label: string; count: number; detail: string }>;
}

export interface IntelligenceContent {
  metrics: CommandMetric[];
  usage: LlmUsageRow[];
  scoreBands: Array<{ range: string; hitRatePct: number; roiPct: number; total: number }>;
  warnings: Array<{ segment: string; message: string }>;
}

function formatRelativeTime(timestamp: string) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return 'unknown time';
  const diffMinutes = Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
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

export async function getPipelineContent(): Promise<PipelineContent | null> {
  try {
    const snapshot = await getPipelineHealthSnapshot();
    return {
      metrics: [
        { label: 'Items in flight', value: snapshot.itemsInFlight, delta: `${snapshot.averageThroughputPerHour}/hr` },
        { label: 'Stage errors', value: snapshot.errorCount, delta: snapshot.overallStatus },
        { label: 'Backlog buckets', value: snapshot.backlogRows.length, delta: 'measured' },
        { label: 'Promotion lanes', value: snapshot.promotionQueueRows.length, delta: 'measured' },
      ],
      pipeline: snapshot.stages.map((stage) => ({
        key: stage.key,
        label: stage.label,
        status: pipelineStatusTone(stage.status),
        metric: `${stage.count}`,
        detail: `${stage.detail} · ${Math.round(stage.lagMs / 60_000)}m lag`,
      })),
      backlog: snapshot.backlogRows.map((row) => ({ label: row.label, count: row.count, detail: row.detail })),
      promotion: snapshot.promotionQueueRows.map((row) => ({ label: row.label, count: row.count, detail: row.detail })),
    };
  } catch {
    return null;
  }
}

export async function getEventsContent(): Promise<{ metrics: CommandMetric[]; events: EventStreamItem[] } | null> {
  try {
    const stream = await getEventStream(18);
    const items = mapEventItems(stream.events);
    return {
      metrics: [
        { label: 'Events loaded', value: items.length, delta: 'measured' },
        { label: 'Submission events', value: items.filter((item) => item.source.includes('submission')).length },
        { label: 'Warnings', value: items.filter((item) => item.status === 'warning').length },
        { label: 'Errors', value: items.filter((item) => item.status === 'error').length },
      ],
      events: items,
    };
  } catch {
    return null;
  }
}

export async function getIntelligenceContent(): Promise<IntelligenceContent | null> {
  try {
    const [performance, intelligence] = await Promise.all([getPerformanceData(), getIntelligenceData()]);
    if (!performance || !intelligence) return null;
    return {
      metrics: [
        { label: 'Settled picks', value: performance.windows.last7d.settled, delta: `${performance.windows.last7d.hitRatePct}% hit` },
        { label: '7d ROI', value: performance.windows.last7d.roiPct, unit: '%' },
        { label: 'Approved delta', value: Number(performance.insights.approvedVsDeniedDelta.toFixed(1)), unit: '%' },
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
