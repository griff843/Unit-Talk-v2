import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export interface HealthSignal {
  component: string;
  status: 'healthy' | 'degraded' | 'down';
  observedAt: string;
}

export type QueueHealthStatus = 'healthy' | 'degraded' | 'down';

export interface QueueHealthThresholds {
  pendingWarnMs: number;
  pendingCriticalMs: number;
  processingStaleMs: number;
  deliveryStaleMs: number;
}

export interface QueueHealthOutboxRow {
  id: string;
  status: string;
  target: string;
  createdAt: string;
  updatedAt?: string | null | undefined;
  claimedAt?: string | null | undefined;
  attemptCount?: number | null | undefined;
}

export interface QueueHealthTargetMismatch {
  target: string;
  requiredWorkerTarget?: string | undefined;
  reason: 'missing-worker' | 'pending-outside-worker' | 'blocked-target';
}

export interface QueueHealthAlert {
  level: 'warning' | 'critical';
  code:
    | 'pending_stale'
    | 'processing_stale'
    | 'dead_letter'
    | 'failed_rows'
    | 'delivery_stale'
    | 'delivery_missing'
    | 'target_mismatch';
  message: string;
  target?: string | undefined;
  count?: number | undefined;
  ageMs?: number | undefined;
}

export interface QueueHealthEvaluation {
  status: QueueHealthStatus;
  observedAt: string;
  workerTargets: string[];
  queueDepth: number;
  pendingCount: number;
  pendingByTarget: Record<string, number>;
  failedCount: number;
  deadLetterCount: number;
  processingCount: number;
  oldestPendingAt: string | null;
  oldestPendingAgeMs: number | null;
  oldestPendingTarget: string | null;
  lastSuccessfulDeliveryAt: string | null;
  lastSuccessfulDeliveryAgeMs: number | null;
  targetMismatches: QueueHealthTargetMismatch[];
  alerts: QueueHealthAlert[];
  metrics: Record<string, number>;
}

export interface EvaluateQueueHealthInput {
  observedAt: string;
  workerTargets: readonly string[];
  outboxRows: readonly QueueHealthOutboxRow[];
  lastSuccessfulDeliveryAt?: string | null | undefined;
  targetMismatches?: readonly QueueHealthTargetMismatch[] | undefined;
  thresholds?: Partial<QueueHealthThresholds> | undefined;
}

export const defaultQueueHealthThresholds: QueueHealthThresholds = {
  pendingWarnMs: 30 * 60 * 1000,
  pendingCriticalMs: 120 * 60 * 1000,
  processingStaleMs: 5 * 60 * 1000,
  deliveryStaleMs: 60 * 60 * 1000,
};

export function evaluateQueueHealth(input: EvaluateQueueHealthInput): QueueHealthEvaluation {
  const thresholds = { ...defaultQueueHealthThresholds, ...input.thresholds };
  const observedAtMs = safeTime(input.observedAt);
  const workerTargets = uniqueStrings(input.workerTargets);
  const workerTargetSet = new Set(workerTargets);
  const pendingRows = input.outboxRows.filter((row) => row.status === 'pending');
  const processingRows = input.outboxRows.filter((row) => row.status === 'processing');
  const failedRows = input.outboxRows.filter((row) => row.status === 'failed');
  const deadLetterRows = input.outboxRows.filter((row) => row.status === 'dead_letter');
  const pendingByTarget = countByTarget(pendingRows);
  const oldestPending = oldestByTimestamp(pendingRows, (row) => row.createdAt);
  const oldestPendingAgeMs = oldestPending ? ageMs(observedAtMs, oldestPending.createdAt) : null;
  const inferredLastSuccessfulDeliveryAt =
    input.lastSuccessfulDeliveryAt ?? newestSentTimestamp(input.outboxRows);
  const lastSuccessfulDeliveryAgeMs = inferredLastSuccessfulDeliveryAt
    ? ageMs(observedAtMs, inferredLastSuccessfulDeliveryAt)
    : null;
  const targetMismatches = [
    ...(input.targetMismatches ?? []),
    ...pendingRows
      .filter((row) => workerTargets.length > 0 && !workerTargetSet.has(row.target))
      .map((row) => ({
        target: row.target,
        reason: 'pending-outside-worker' as const,
      })),
  ];
  const alerts: QueueHealthAlert[] = [];

  if (targetMismatches.length > 0) {
    alerts.push({
      level: 'critical',
      code: 'target_mismatch',
      count: targetMismatches.length,
      message: `${targetMismatches.length} target mismatch(es) can strand pending work`,
    });
  }

  if (deadLetterRows.length > 0) {
    alerts.push({
      level: 'critical',
      code: 'dead_letter',
      count: deadLetterRows.length,
      message: `${deadLetterRows.length} dead-letter row(s) require operator review`,
    });
  }

  if (failedRows.length > 0) {
    alerts.push({
      level: 'warning',
      code: 'failed_rows',
      count: failedRows.length,
      message: `${failedRows.length} failed row(s) are waiting for retry handling`,
    });
  }

  const staleProcessing = processingRows.filter((row) => {
    const reference = row.claimedAt ?? row.updatedAt ?? row.createdAt;
    const currentAgeMs = ageMs(observedAtMs, reference);
    return currentAgeMs !== null && currentAgeMs >= thresholds.processingStaleMs;
  });
  if (staleProcessing.length > 0) {
    alerts.push({
      level: 'critical',
      code: 'processing_stale',
      count: staleProcessing.length,
      message: `${staleProcessing.length} processing row(s) exceeded the stale-claim threshold`,
    });
  }

  if (oldestPending && oldestPendingAgeMs !== null) {
    if (oldestPendingAgeMs >= thresholds.pendingCriticalMs) {
      alerts.push({
        level: 'critical',
        code: 'pending_stale',
        target: oldestPending.target,
        ageMs: oldestPendingAgeMs,
        message: `oldest pending row is ${formatAgeMinutes(oldestPendingAgeMs)} old`,
      });
    } else if (oldestPendingAgeMs >= thresholds.pendingWarnMs) {
      alerts.push({
        level: 'warning',
        code: 'pending_stale',
        target: oldestPending.target,
        ageMs: oldestPendingAgeMs,
        message: `oldest pending row is ${formatAgeMinutes(oldestPendingAgeMs)} old`,
      });
    }
  }

  if (pendingRows.length > 0) {
    if (!inferredLastSuccessfulDeliveryAt) {
      alerts.push({
        level: 'critical',
        code: 'delivery_missing',
        message: 'pending work exists but no successful delivery timestamp is visible',
      });
    } else if (
      lastSuccessfulDeliveryAgeMs !== null &&
      lastSuccessfulDeliveryAgeMs >= thresholds.deliveryStaleMs
    ) {
      alerts.push({
        level: 'critical',
        code: 'delivery_stale',
        ageMs: lastSuccessfulDeliveryAgeMs,
        message: `last successful delivery is ${formatAgeMinutes(lastSuccessfulDeliveryAgeMs)} old`,
      });
    }
  }

  const status: QueueHealthStatus = alerts.some((alert) => alert.level === 'critical')
    ? 'down'
    : alerts.length > 0
      ? 'degraded'
      : 'healthy';

  return {
    status,
    observedAt: input.observedAt,
    workerTargets,
    queueDepth: input.outboxRows.length,
    pendingCount: pendingRows.length,
    pendingByTarget,
    failedCount: failedRows.length,
    deadLetterCount: deadLetterRows.length,
    processingCount: processingRows.length,
    oldestPendingAt: oldestPending?.createdAt ?? null,
    oldestPendingAgeMs,
    oldestPendingTarget: oldestPending?.target ?? null,
    lastSuccessfulDeliveryAt: inferredLastSuccessfulDeliveryAt ?? null,
    lastSuccessfulDeliveryAgeMs,
    targetMismatches,
    alerts,
    metrics: {
      queueDepth: input.outboxRows.length,
      pendingCount: pendingRows.length,
      failedCount: failedRows.length,
      deadLetterCount: deadLetterRows.length,
      processingCount: processingRows.length,
      oldestPendingAgeMs: oldestPendingAgeMs ?? 0,
      lastSuccessfulDeliveryAgeMs: lastSuccessfulDeliveryAgeMs ?? -1,
      targetMismatchCount: targetMismatches.length,
    },
  };
}

export function recordQueueHealthMetrics(
  collector: Pick<MetricsCollector, 'gauge'>,
  evaluation: QueueHealthEvaluation,
): void {
  collector.gauge('distribution_outbox_depth', evaluation.queueDepth);
  collector.gauge('distribution_outbox_pending_total', evaluation.pendingCount);
  collector.gauge('distribution_outbox_failed_total', evaluation.failedCount);
  collector.gauge('distribution_outbox_dead_letter_total', evaluation.deadLetterCount);
  collector.gauge('distribution_outbox_processing_total', evaluation.processingCount);
  collector.gauge('distribution_outbox_oldest_pending_age_ms', evaluation.oldestPendingAgeMs ?? 0);
  collector.gauge(
    'distribution_last_successful_delivery_age_ms',
    evaluation.lastSuccessfulDeliveryAgeMs ?? -1,
  );
  collector.gauge('distribution_target_mismatch_total', evaluation.targetMismatches.length);

  for (const [target, count] of Object.entries(evaluation.pendingByTarget)) {
    collector.gauge('distribution_outbox_pending_by_target', count, { target });
  }
}

export function queueHealthLogFields(evaluation: QueueHealthEvaluation): LogFields {
  return {
    status: evaluation.status,
    queueDepth: evaluation.queueDepth,
    pendingCount: evaluation.pendingCount,
    failedCount: evaluation.failedCount,
    deadLetterCount: evaluation.deadLetterCount,
    oldestPendingAgeMs: evaluation.oldestPendingAgeMs,
    oldestPendingTarget: evaluation.oldestPendingTarget,
    lastSuccessfulDeliveryAt: evaluation.lastSuccessfulDeliveryAt,
    lastSuccessfulDeliveryAgeMs: evaluation.lastSuccessfulDeliveryAgeMs,
    targetMismatchCount: evaluation.targetMismatches.length,
    alerts: evaluation.alerts.map((alert) => ({
      level: alert.level,
      code: alert.code,
      message: alert.message,
      target: alert.target ?? null,
      count: alert.count ?? null,
      ageMs: alert.ageMs ?? null,
    })),
  };
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogValue =
  | boolean
  | number
  | string
  | null
  | LogValue[]
  | { [key: string]: LogValue };

export type LogFields = Record<string, LogValue>;

export interface StructuredLogEntry extends LogFields {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
}

export interface LogWriter {
  write(level: LogLevel, entry: StructuredLogEntry): void;
}

export interface Logger {
  child(fields: LogFields): Logger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, error?: unknown, fields?: LogFields): void;
}

export interface ObservabilityStackDecision {
  logs: 'loki';
  metrics: 'prometheus-json';
  errors: 'structured-error-events';
  dashboards: 'operator-web';
}

export const OBSERVABILITY_STACK_DECISION: ObservabilityStackDecision = {
  logs: 'loki',
  metrics: 'prometheus-json',
  errors: 'structured-error-events',
  dashboards: 'operator-web',
};

export interface CreateLoggerOptions {
  service: string;
  fields?: LogFields;
  writer?: LogWriter;
  now?: () => string;
}

const CORRELATION_ID_HEADER_NAMES = ['x-correlation-id', 'x-request-id'] as const;

export function createLogger(options: CreateLoggerOptions): Logger {
  const baseFields = sanitizeFields(options.fields);
  const writer = options.writer ?? createConsoleLogWriter();
  const now = options.now ?? (() => new Date().toISOString());

  function emit(level: LogLevel, message: string, fields?: LogFields) {
    const entry: StructuredLogEntry = {
      timestamp: now(),
      level,
      service: options.service,
      message,
      ...baseFields,
      ...sanitizeFields(fields),
    };
    writer.write(level, entry);
  }

  return {
    child(fields: LogFields) {
      return createLogger({
        ...options,
        fields: {
          ...baseFields,
          ...sanitizeFields(fields),
        },
        writer,
        now,
      });
    },
    debug(message: string, fields?: LogFields) {
      emit('debug', message, fields);
    },
    info(message: string, fields?: LogFields) {
      emit('info', message, fields);
    },
    warn(message: string, fields?: LogFields) {
      emit('warn', message, fields);
    },
    error(message: string, error?: unknown, fields?: LogFields) {
      emit('error', message, {
        ...sanitizeFields(fields),
        ...(error === undefined ? {} : { error: serializeError(error) }),
      });
    },
  };
}

export interface LokiLogWriterOptions {
  url: string;
  batchSize?: number;
  flushIntervalMs?: number;
  tenantId?: string;
  fetchImpl?: typeof fetch;
}

export function createLokiLogWriter(options: LokiLogWriterOptions): LogWriter & { flush(): Promise<void>; stop(): void } {
  const batchSize = options.batchSize ?? 10;
  const flushIntervalMs = options.flushIntervalMs ?? 5000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const buffer: Array<{ level: LogLevel; entry: StructuredLogEntry }> = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;

  async function pushToLoki(entries: Array<{ level: LogLevel; entry: StructuredLogEntry }>) {
    const streamMap = new Map<string, Array<[string, string]>>();

    for (const { entry } of entries) {
      const streamKey = `${entry.service}|${entry.level}`;
      if (!streamMap.has(streamKey)) {
        streamMap.set(streamKey, []);
      }
      const ts = String(BigInt(new Date(entry.timestamp).getTime()) * 1_000_000n);
      streamMap.get(streamKey)!.push([ts, JSON.stringify(entry)]);
    }

    const streams = Array.from(streamMap.entries()).map(([key, values]) => {
      const [service, level] = key.split('|');
      return {
        stream: { service: service ?? 'unknown', level: level ?? 'info' },
        values,
      };
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.tenantId) {
      headers['X-Scope-OrgID'] = options.tenantId;
    }

    try {
      await fetchImpl(`${options.url}/loki/api/v1/push`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ streams }),
      });
    } catch (err) {
      console.error(`[loki-writer] push failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function flush() {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0);
    await pushToLoki(batch);
  }

  flushTimer = setInterval(() => {
    flush().catch(() => {});
  }, flushIntervalMs);

  return {
    write(level: LogLevel, entry: StructuredLogEntry) {
      buffer.push({ level, entry });
      if (buffer.length >= batchSize) {
        flush().catch(() => {});
      }
    },
    async flush() {
      await flush();
    },
    stop() {
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      flush().catch(() => {});
    },
  };
}

export function createDualLogWriter(primary: LogWriter, secondary: LogWriter): LogWriter {
  return {
    write(level: LogLevel, entry: StructuredLogEntry) {
      primary.write(level, entry);
      try {
        secondary.write(level, entry);
      } catch {
        // Secondary failure must not block primary logging
      }
    },
  };
}

export function createConsoleLogWriter(): LogWriter {
  return {
    write(level: LogLevel, entry: StructuredLogEntry) {
      const line = JSON.stringify(entry);

      if (level === 'error') {
        console.error(line);
        return;
      }

      if (level === 'warn') {
        console.warn(line);
        return;
      }

      console.log(line);
    },
  };
}

export interface ErrorCaptureInput {
  error: unknown;
  service: string;
  operation: string;
  severity?: 'warning' | 'error' | 'critical';
  correlationId?: string;
  fields?: LogFields;
}

export interface ErrorCaptureEvent {
  timestamp: string;
  service: string;
  operation: string;
  severity: 'warning' | 'error' | 'critical';
  error: LogValue;
  correlationId?: string;
  fields: LogFields;
}

export interface ErrorTrackingSink {
  capture(event: ErrorCaptureEvent): void | Promise<void>;
}

export interface ErrorTracker {
  captureException(input: Omit<ErrorCaptureInput, 'service'>): Promise<ErrorCaptureEvent>;
}

export interface CreateErrorTrackerOptions {
  service: string;
  sink?: ErrorTrackingSink;
  logger?: Logger;
  now?: () => string;
}

export function createErrorTracker(options: CreateErrorTrackerOptions): ErrorTracker {
  const now = options.now ?? (() => new Date().toISOString());
  const sink = options.sink ?? createLoggerErrorTrackingSink(options.logger);

  return {
    async captureException(input) {
      const event = createErrorCaptureEvent(
        {
          ...input,
          service: options.service,
        },
        now,
      );
      await sink.capture(event);
      return event;
    },
  };
}

export function createLoggerErrorTrackingSink(logger?: Logger): ErrorTrackingSink {
  return {
    capture(event) {
      const message = `error-tracking: ${event.operation}`;
      const fields: LogFields = {
        errorTracking: true,
        operation: event.operation,
        severity: event.severity,
        ...(event.correlationId ? { correlationId: event.correlationId } : {}),
        ...event.fields,
      };

      if (logger) {
        logger.error(message, event.error, fields);
        return;
      }

      createConsoleLogWriter().write('error', {
        timestamp: event.timestamp,
        level: 'error',
        service: event.service,
        message,
        ...fields,
        error: event.error,
      });
    },
  };
}

export function createMemoryErrorTrackingSink() {
  const events: ErrorCaptureEvent[] = [];
  return {
    events,
    sink: {
      capture(event: ErrorCaptureEvent) {
        events.push(event);
      },
    } satisfies ErrorTrackingSink,
  };
}

export function createErrorCaptureEvent(
  input: ErrorCaptureInput,
  now: () => string = () => new Date().toISOString(),
): ErrorCaptureEvent {
  return {
    timestamp: now(),
    service: input.service,
    operation: input.operation,
    severity: input.severity ?? 'error',
    error: serializeError(input.error),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    fields: sanitizeFields(input.fields),
  };
}

export function createCorrelationId(seed?: string) {
  const normalized = normalizeCorrelationId(seed);
  return normalized ?? randomUUID();
}

export function normalizeCorrelationId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 128) : undefined;
}

export function readCorrelationId(
  headers:
    | Headers
    | IncomingHttpHeaders
    | Record<string, string | string[] | undefined>,
) {
  for (const headerName of CORRELATION_ID_HEADER_NAMES) {
    const value = readHeaderValue(headers, headerName);
    const normalized = normalizeCorrelationId(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export function getOrCreateCorrelationId(
  headers:
    | Headers
    | IncomingHttpHeaders
    | Record<string, string | string[] | undefined>,
) {
  return createCorrelationId(readCorrelationId(headers));
}

export function createRequestLogFields(input: {
  correlationId: string;
  method: string;
  path: string;
  remoteAddress?: string | null;
}) {
  return {
    correlationId: input.correlationId,
    method: input.method,
    path: input.path,
    ...(input.remoteAddress ? { remoteAddress: input.remoteAddress } : {}),
  } satisfies LogFields;
}

export function serializeError(error: unknown): LogValue {
  if (error instanceof Error) {
    const details: Record<string, LogValue> = {
      name: error.name,
      message: error.message,
    };

    if (typeof error.stack === 'string' && error.stack.length > 0) {
      details.stack = error.stack;
    }

    const cause = Reflect.get(error, 'cause');
    if (cause !== undefined) {
      details.cause = serializeError(cause);
    }

    return details;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (
    typeof error === 'number' ||
    typeof error === 'boolean' ||
    error === null ||
    error === undefined
  ) {
    return error ?? null;
  }

  if (Array.isArray(error)) {
    return error.map((value) => coerceLogValue(value));
  }

  if (typeof error === 'object') {
    const serialized: Record<string, LogValue> = {};
    for (const [key, value] of Object.entries(error)) {
      serialized[key] = coerceLogValue(value);
    }
    return serialized;
  }

  return String(error);
}

function sanitizeFields(fields: LogFields | undefined) {
  if (!fields) {
    return {};
  }

  const sanitized: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    sanitized[key] = coerceLogValue(value);
  }

  return sanitized;
}

function coerceLogValue(value: unknown): LogValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return value;
  }

  if (value === undefined) {
    return null;
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => coerceLogValue(entry));
  }

  if (typeof value === 'object') {
    const objectValue: Record<string, LogValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      objectValue[key] = coerceLogValue(entry);
    }
    return objectValue;
  }

  return String(value);
}

// ---------------------------------------------------------------------------
// Metrics Collector
// ---------------------------------------------------------------------------

export type MetricLabels = Record<string, string>;

interface CounterEntry {
  value: number;
  labels: MetricLabels;
}

interface GaugeEntry {
  value: number;
  labels: MetricLabels;
}

interface HistogramEntry {
  count: number;
  sum: number;
  buckets: Map<number, number>;
  labels: MetricLabels;
}

export interface MetricsSnapshot {
  counters: Record<string, { value: number; labels: MetricLabels }[]>;
  gauges: Record<string, { value: number; labels: MetricLabels }[]>;
  histograms: Record<
    string,
    {
      count: number;
      sum: number;
      buckets: Record<string, number>;
      labels: MetricLabels;
    }[]
  >;
}

const DEFAULT_DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

function labelsKey(labels: MetricLabels | undefined): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

function metricKey(name: string, labels: MetricLabels | undefined): string {
  return `${name}|${labelsKey(labels)}`;
}

export class MetricsCollector {
  readonly #counters = new Map<string, CounterEntry>();
  readonly #gauges = new Map<string, GaugeEntry>();
  readonly #histograms = new Map<string, HistogramEntry>();
  readonly #buckets: number[];

  constructor(buckets: number[] = DEFAULT_DURATION_BUCKETS) {
    this.#buckets = [...buckets].sort((a, b) => a - b);
  }

  increment(metric: string, labels?: MetricLabels): void {
    const key = metricKey(metric, labels);
    const existing = this.#counters.get(key);
    if (existing) {
      existing.value += 1;
    } else {
      this.#counters.set(key, { value: 1, labels: labels ?? {} });
    }
  }

  gauge(metric: string, value: number, labels?: MetricLabels): void {
    const key = metricKey(metric, labels);
    this.#gauges.set(key, { value, labels: labels ?? {} });
  }

  histogram(metric: string, value: number, labels?: MetricLabels): void {
    const key = metricKey(metric, labels);
    const existing = this.#histograms.get(key);
    if (existing) {
      existing.count += 1;
      existing.sum += value;
      for (const bound of this.#buckets) {
        if (value <= bound) {
          existing.buckets.set(bound, (existing.buckets.get(bound) ?? 0) + 1);
        }
      }
    } else {
      const bucketMap = new Map<number, number>();
      for (const bound of this.#buckets) {
        bucketMap.set(bound, value <= bound ? 1 : 0);
      }
      this.#histograms.set(key, {
        count: 1,
        sum: value,
        buckets: bucketMap,
        labels: labels ?? {},
      });
    }
  }

  snapshot(): MetricsSnapshot {
    const counters: MetricsSnapshot['counters'] = {};
    for (const entry of this.#counters.values()) {
      const name = this.#nameFromEntry(this.#counters, entry);
      if (!counters[name]) counters[name] = [];
      counters[name].push({ value: entry.value, labels: { ...entry.labels } });
    }

    const gauges: MetricsSnapshot['gauges'] = {};
    for (const entry of this.#gauges.values()) {
      const name = this.#nameFromEntry(this.#gauges, entry);
      if (!gauges[name]) gauges[name] = [];
      gauges[name].push({ value: entry.value, labels: { ...entry.labels } });
    }

    const histograms: MetricsSnapshot['histograms'] = {};
    for (const entry of this.#histograms.values()) {
      const name = this.#nameFromEntry(this.#histograms, entry);
      if (!histograms[name]) histograms[name] = [];
      const bucketObj: Record<string, number> = {};
      for (const [bound, count] of entry.buckets) {
        bucketObj[String(bound)] = count;
      }
      histograms[name].push({
        count: entry.count,
        sum: entry.sum,
        buckets: bucketObj,
        labels: { ...entry.labels },
      });
    }

    return { counters, gauges, histograms };
  }

  #nameFromEntry<T>(map: Map<string, T>, entry: T): string {
    for (const [key, val] of map) {
      if (val === entry) {
        return key.split('|')[0] ?? '';
      }
    }
    return '';
  }
}

export function createMetricsCollector(buckets?: number[]): MetricsCollector {
  return new MetricsCollector(buckets);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function countByTarget(rows: readonly QueueHealthOutboxRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.target] = (counts[row.target] ?? 0) + 1;
  }
  return counts;
}

function oldestByTimestamp<T>(rows: readonly T[], readTimestamp: (row: T) => string): T | null {
  let oldest: T | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const ts = safeTime(readTimestamp(row));
    if (ts !== null && ts < oldestMs) {
      oldest = row;
      oldestMs = ts;
    }
  }
  return oldest;
}

function newestSentTimestamp(rows: readonly QueueHealthOutboxRow[]): string | null {
  let newest: string | null = null;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.status !== 'sent') {
      continue;
    }
    const timestamp = row.updatedAt ?? row.createdAt;
    const ts = safeTime(timestamp);
    if (ts !== null && ts > newestMs) {
      newest = timestamp;
      newestMs = ts;
    }
  }
  return newest;
}

function ageMs(observedAtMs: number | null, timestamp: string | null | undefined): number | null {
  const ts = safeTime(timestamp);
  if (observedAtMs === null || ts === null) {
    return null;
  }
  return Math.max(observedAtMs - ts, 0);
}

function safeTime(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }
  const ts = Date.parse(timestamp);
  return Number.isFinite(ts) ? ts : null;
}

function formatAgeMinutes(valueMs: number): string {
  return `${Math.round(valueMs / 60000)}m`;
}

function readHeaderValue(
  headers:
    | Headers
    | IncomingHttpHeaders
    | Record<string, string | string[] | undefined>,
  headerName: string,
) {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(headerName) ?? undefined;
  }

  const rawValue = (headers as Record<string, string | string[] | undefined>)[headerName];
  if (Array.isArray(rawValue)) {
    return rawValue[0];
  }

  return rawValue;
}
