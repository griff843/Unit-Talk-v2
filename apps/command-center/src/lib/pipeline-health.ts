export type PipelineStageKey = 'ingest' | 'normalize' | 'grade' | 'promote' | 'publish';

export type PipelineStageStatus = 'healthy' | 'warning' | 'error' | 'idle';

export interface PipelineHealthRow {
  label: string;
  count: number;
  trend: number[];
  direction: 'up' | 'down' | 'flat';
  detail: string;
}

export interface PipelineStageViewModel {
  key: PipelineStageKey;
  label: string;
  status: PipelineStageStatus;
  count: number;
  errorCount: number;
  warningCount: number;
  lagMs: number;
  lagTrend: number[];
  detail: string;
}

export interface PipelineLiveConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  tables: string[];
}

export interface PipelineHealthSnapshot {
  observedAt: string;
  overallStatus: PipelineStageStatus;
  itemsInFlight: number;
  errorCount: number;
  averageThroughputPerHour: number;
  stages: PipelineStageViewModel[];
  backlogRows: PipelineHealthRow[];
  promotionQueueRows: PipelineHealthRow[];
  liveConfig: PipelineLiveConfig | null;
}

export interface SubmissionStageRecord {
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PickStageRecord {
  status: string;
  promotion_status: string | null;
  promotion_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface OutboxStageRecord {
  status: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
}

export interface ReceiptStageRecord {
  recorded_at: string;
}

export interface RunStageRecord {
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
}

export interface PipelineHealthInput {
  observedAt: string;
  submissions: SubmissionStageRecord[];
  picks: PickStageRecord[];
  outbox: OutboxStageRecord[];
  receipts: ReceiptStageRecord[];
  runs: RunStageRecord[];
  liveConfig: PipelineLiveConfig | null;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const LIVE_TABLES = ['submissions', 'picks', 'distribution_outbox', 'distribution_receipts', 'system_runs'] as const;

function toMs(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ageMs(nowMs: number, value: string | null | undefined) {
  const parsed = toMs(value);
  return parsed > 0 ? Math.max(0, nowMs - parsed) : 0;
}

function maxAgeMs(nowMs: number, values: Array<string | null | undefined>) {
  return values.reduce((max, value) => Math.max(max, ageMs(nowMs, value)), 0);
}

function trendDirection(trend: number[]): 'up' | 'down' | 'flat' {
  if (trend.length < 2) return 'flat';
  const last = trend[trend.length - 1] ?? 0;
  const prev = trend[trend.length - 2] ?? 0;
  if (last > prev) return 'up';
  if (last < prev) return 'down';
  return 'flat';
}

function buildCountTrend(timestamps: string[], observedAt: string, bucketMinutes = 10, bucketCount = 8) {
  const nowMs = toMs(observedAt);
  const bucketMs = bucketMinutes * 60 * 1000;
  const buckets = Array.from({ length: bucketCount }, () => 0);

  for (const timestamp of timestamps) {
    const diff = nowMs - toMs(timestamp);
    if (diff < 0) continue;
    const bucketIndex = bucketCount - 1 - Math.floor(diff / bucketMs);
    if (bucketIndex >= 0 && bucketIndex < bucketCount) {
      buckets[bucketIndex] = (buckets[bucketIndex] ?? 0) + 1;
    }
  }

  return buckets;
}

function buildLagTrend(nowMs: number, timestamps: string[], bucketMinutes = 10, bucketCount = 8) {
  const bucketMs = bucketMinutes * 60 * 1000;
  const buckets = Array.from({ length: bucketCount }, () => [] as number[]);

  for (const timestamp of timestamps) {
    const diff = nowMs - toMs(timestamp);
    if (diff < 0) continue;
    const bucketIndex = bucketCount - 1 - Math.floor(diff / bucketMs);
    if (bucketIndex >= 0 && bucketIndex < bucketCount) {
      buckets[bucketIndex]?.push(ageMs(nowMs, timestamp));
    }
  }

  return buckets.map((values) => {
    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  });
}

function buildRow(label: string, count: number, trend: number[], detail: string): PipelineHealthRow {
  return {
    label,
    count,
    trend,
    direction: trendDirection(trend),
    detail,
  };
}

function resolveOverallStatus(stages: PipelineStageViewModel[]): PipelineStageStatus {
  if (stages.some((stage) => stage.status === 'error')) return 'error';
  if (stages.some((stage) => stage.status === 'warning')) return 'warning';
  if (stages.every((stage) => stage.status === 'idle')) return 'idle';
  return 'healthy';
}

export function createPipelineLiveConfig(supabaseUrl: string | null, supabaseAnonKey: string | null): PipelineLiveConfig | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return {
    supabaseUrl,
    supabaseAnonKey,
    tables: [...LIVE_TABLES],
  };
}

export function derivePipelineHealthSnapshot(input: PipelineHealthInput): PipelineHealthSnapshot {
  const nowMs = toMs(input.observedAt);
  const submissions = input.submissions;
  const picks = input.picks;
  const outbox = input.outbox;
  const receipts = input.receipts;
  const runs = input.runs;

  const receivedSubmissions = submissions.filter((row) => row.status === 'received');
  const validatedSubmissions = submissions.filter((row) => row.status === 'validated');
  const rejectedSubmissions = submissions.filter((row) => row.status === 'rejected');
  const materializedSubmissions = submissions.filter((row) => row.status === 'materialized');

  const openPicks = picks.filter((row) => row.status === 'validated' || row.status === 'queued' || row.status === 'posted');
  const postedPicks = picks.filter((row) => row.status === 'posted');
  const unscoredPicks = openPicks.filter((row) => row.promotion_score == null);
  const scoredPicks = openPicks.filter((row) => row.promotion_score != null);
  const pendingPromotion = openPicks.filter((row) => row.promotion_status === 'pending');
  const qualifiedPromotion = openPicks.filter((row) => row.promotion_status === 'qualified');
  const suppressedPromotion = openPicks.filter((row) => row.promotion_status === 'not_eligible' || row.promotion_status === 'suppressed');

  const pendingOutbox = outbox.filter((row) => row.status === 'pending');
  const processingOutbox = outbox.filter((row) => row.status === 'processing');
  const failedOutbox = outbox.filter((row) => row.status === 'failed');
  const deadLetterOutbox = outbox.filter((row) => row.status === 'dead_letter');
  const sentOutbox = outbox.filter((row) => row.status === 'sent');

  const latestGradingRun = runs.find((row) => row.run_type === 'grading.run');
  const latestIngestorRun = runs.find((row) => row.run_type.startsWith('ingestor'));

  const ingestLagMs = maxAgeMs(nowMs, receivedSubmissions.map((row) => row.created_at));
  const normalizeLagMs = maxAgeMs(nowMs, validatedSubmissions.map((row) => row.updated_at));
  const gradeLagMs = maxAgeMs(nowMs, unscoredPicks.map((row) => row.created_at));
  const promoteLagMs = maxAgeMs(nowMs, pendingPromotion.map((row) => row.updated_at));
  const publishLagMs = Math.max(
    maxAgeMs(nowMs, pendingOutbox.map((row) => row.created_at)),
    maxAgeMs(nowMs, processingOutbox.map((row) => row.claimed_at ?? row.updated_at)),
  );

  const ingestStatus: PipelineStageStatus =
    receivedSubmissions.length === 0
      ? materializedSubmissions.length === 0 ? 'idle' : 'healthy'
      : ingestLagMs > THIRTY_MINUTES_MS ? 'error' : ingestLagMs > TEN_MINUTES_MS ? 'warning' : 'healthy';

  const normalizeStatus: PipelineStageStatus =
    validatedSubmissions.length === 0
      ? 'idle'
      : normalizeLagMs > THIRTY_MINUTES_MS ? 'error' : normalizeLagMs > TEN_MINUTES_MS ? 'warning' : 'healthy';

  const gradeStatus: PipelineStageStatus =
    unscoredPicks.length === 0
      ? scoredPicks.length === 0 ? 'idle' : 'healthy'
      : gradeLagMs > THIRTY_MINUTES_MS
        ? 'error'
        : gradeLagMs > FIFTEEN_MINUTES_MS || ageMs(nowMs, latestGradingRun?.started_at) > TWO_HOURS_MS
          ? 'warning'
          : 'healthy';

  const promoteStatus: PipelineStageStatus =
    pendingPromotion.length === 0 && qualifiedPromotion.length === 0
      ? suppressedPromotion.length > 0 ? 'warning' : 'idle'
      : promoteLagMs > THIRTY_MINUTES_MS ? 'error' : promoteLagMs > FIFTEEN_MINUTES_MS ? 'warning' : 'healthy';

  const processingStuckCount = processingOutbox.filter((row) => ageMs(nowMs, row.claimed_at ?? row.updated_at) > TEN_MINUTES_MS).length;
  const publishStatus: PipelineStageStatus =
    deadLetterOutbox.length > 0 || failedOutbox.length > 0
      ? 'error'
      : pendingOutbox.some((row) => ageMs(nowMs, row.created_at) > THIRTY_MINUTES_MS) || processingStuckCount > 0
        ? 'warning'
        : pendingOutbox.length === 0 && processingOutbox.length === 0 && postedPicks.length === 0
          ? sentOutbox.length === 0 ? 'idle' : 'healthy'
          : 'healthy';

  const stages: PipelineStageViewModel[] = [
    {
      key: 'ingest',
      label: 'Ingest',
      status: ingestStatus,
      count: receivedSubmissions.length,
      errorCount: ingestStatus === 'error' ? receivedSubmissions.length : 0,
      warningCount: ingestStatus === 'warning' ? receivedSubmissions.length : 0,
      lagMs: ingestLagMs,
      lagTrend: buildLagTrend(nowMs, receivedSubmissions.map((row) => row.created_at)),
      detail: receivedSubmissions.length > 0
        ? `${receivedSubmissions.length} received submissions waiting to clear intake`
        : latestIngestorRun ? `Latest ingest activity ${latestIngestorRun.started_at}` : 'No intake backlog',
    },
    {
      key: 'normalize',
      label: 'Normalize',
      status: normalizeStatus,
      count: validatedSubmissions.length,
      errorCount: normalizeStatus === 'error' ? validatedSubmissions.length : 0,
      warningCount: rejectedSubmissions.length,
      lagMs: normalizeLagMs,
      lagTrend: buildLagTrend(nowMs, validatedSubmissions.map((row) => row.updated_at)),
      detail: validatedSubmissions.length > 0
        ? `${validatedSubmissions.length} validated submissions not yet materialized`
        : rejectedSubmissions.length > 0
          ? `${rejectedSubmissions.length} recent rejected submissions`
          : 'Submission normalization is clear',
    },
    {
      key: 'grade',
      label: 'Grade',
      status: gradeStatus,
      count: unscoredPicks.length,
      errorCount: gradeStatus === 'error' ? unscoredPicks.length : 0,
      warningCount: gradeStatus === 'warning' ? unscoredPicks.length : 0,
      lagMs: gradeLagMs,
      lagTrend: buildLagTrend(nowMs, unscoredPicks.map((row) => row.created_at)),
      detail: unscoredPicks.length > 0
        ? `${unscoredPicks.length} open pick(s) still need a promotion score`
        : scoredPicks.length > 0
          ? `${scoredPicks.length} open pick(s) already scored`
          : 'No picks waiting on grading',
    },
    {
      key: 'promote',
      label: 'Promote',
      status: promoteStatus,
      count: pendingPromotion.length + qualifiedPromotion.length,
      errorCount: promoteStatus === 'error' ? pendingPromotion.length : 0,
      warningCount: suppressedPromotion.length,
      lagMs: promoteLagMs,
      lagTrend: buildLagTrend(nowMs, pendingPromotion.map((row) => row.updated_at)),
      detail: pendingPromotion.length > 0 || qualifiedPromotion.length > 0
        ? `${pendingPromotion.length} pending and ${qualifiedPromotion.length} qualified`
        : suppressedPromotion.length > 0
          ? `${suppressedPromotion.length} suppressed or not eligible`
          : 'Promotion queue is empty',
    },
    {
      key: 'publish',
      label: 'Publish',
      status: publishStatus,
      count: pendingOutbox.length + processingOutbox.length + postedPicks.length,
      errorCount: failedOutbox.length + deadLetterOutbox.length,
      warningCount: processingStuckCount,
      lagMs: publishLagMs,
      lagTrend: buildLagTrend(
        nowMs,
        [...pendingOutbox.map((row) => row.created_at), ...processingOutbox.map((row) => row.claimed_at ?? row.updated_at)],
      ),
      detail: deadLetterOutbox.length > 0 || failedOutbox.length > 0
        ? `${failedOutbox.length} failed and ${deadLetterOutbox.length} dead-letter rows`
        : pendingOutbox.length > 0 || processingOutbox.length > 0
          ? `${pendingOutbox.length} pending and ${processingOutbox.length} processing deliveries`
          : postedPicks.length > 0
            ? `${postedPicks.length} posted pick(s) visible`
            : 'Delivery queue is clear',
    },
  ];

  const backlogRows: PipelineHealthRow[] = [
    buildRow(
      'Normalize backlog',
      validatedSubmissions.length,
      buildCountTrend(validatedSubmissions.map((row) => row.updated_at), input.observedAt),
      validatedSubmissions.length > 0 ? 'Validated submissions are waiting to materialize into picks.' : 'No normalization backlog.',
    ),
    buildRow(
      'Grading backlog',
      unscoredPicks.length,
      buildCountTrend(unscoredPicks.map((row) => row.created_at), input.observedAt),
      unscoredPicks.length > 0 ? 'Open picks are waiting for grading or score persistence.' : 'No grading backlog.',
    ),
    buildRow(
      'Publish backlog',
      pendingOutbox.length + processingOutbox.length,
      buildCountTrend(
        [...pendingOutbox.map((row) => row.created_at), ...processingOutbox.map((row) => row.claimed_at ?? row.updated_at)],
        input.observedAt,
      ),
      pendingOutbox.length + processingOutbox.length > 0 ? 'Outbox rows are queued or actively being delivered.' : 'Delivery backlog is clear.',
    ),
  ];

  const promotionQueueRows: PipelineHealthRow[] = [
    buildRow(
      'Pending promotion',
      pendingPromotion.length,
      buildCountTrend(pendingPromotion.map((row) => row.updated_at), input.observedAt),
      pendingPromotion.length > 0 ? 'These picks still need a promotion decision.' : 'No picks are waiting on promotion.',
    ),
    buildRow(
      'Qualified to publish',
      qualifiedPromotion.length,
      buildCountTrend(qualifiedPromotion.map((row) => row.updated_at), input.observedAt),
      qualifiedPromotion.length > 0 ? 'Qualified picks are queued for downstream publish work.' : 'No qualified picks are waiting on publish.',
    ),
    buildRow(
      'Suppressed / not eligible',
      suppressedPromotion.length,
      buildCountTrend(suppressedPromotion.map((row) => row.updated_at), input.observedAt),
      suppressedPromotion.length > 0 ? 'These picks were scored but intentionally kept out of promotion.' : 'No suppressed picks are in the active window.',
    ),
  ];

  const errorCount = stages.reduce((sum, stage) => sum + stage.errorCount, 0);
  const itemsInFlight = stages.reduce((sum, stage) => sum + stage.count, 0);
  const throughputWindowHours = 6;
  const throughputCutoffMs = nowMs - throughputWindowHours * 60 * 60 * 1000;
  const recentPublishedCount = receipts.filter((row) => toMs(row.recorded_at) >= throughputCutoffMs).length;
  const recentMaterializedCount = materializedSubmissions.filter((row) => toMs(row.updated_at) >= throughputCutoffMs).length;
  const averageThroughputPerHour = Number((((recentPublishedCount + recentMaterializedCount) / 2) / throughputWindowHours).toFixed(1));

  return {
    observedAt: input.observedAt,
    overallStatus: resolveOverallStatus(stages),
    itemsInFlight,
    errorCount,
    averageThroughputPerHour,
    stages,
    backlogRows,
    promotionQueueRows,
    liveConfig: input.liveConfig,
  };
}

export function formatPipelineStatusLabel(status: PipelineStageStatus) {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'warning':
      return 'Warning';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

export function formatDurationMs(value: number) {
  if (value <= 0) return '0m';
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = (minutes / 60).toFixed(1).replace(/\.0$/, '');
  return `${hours}h`;
}
