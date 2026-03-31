import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export interface HealthSignal {
  component: string;
  status: 'healthy' | 'degraded' | 'down';
  observedAt: string;
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
