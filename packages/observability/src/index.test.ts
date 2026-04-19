import assert from 'node:assert/strict';
import test from 'node:test';
import { describe, it } from 'node:test';
import {
  createCorrelationId,
  createDualLogWriter,
  createErrorCaptureEvent,
  createErrorTracker,
  createLogger,
  createLokiLogWriter,
  createMemoryErrorTrackingSink,
  createMetricsCollector,
  createRequestLogFields,
  getOrCreateCorrelationId,
  MetricsCollector,
  normalizeCorrelationId,
  OBSERVABILITY_STACK_DECISION,
  serializeError,
  type LogLevel,
  type LogWriter,
  type StructuredLogEntry,
} from './index.js';

test('createLogger writes structured entries with child context', () => {
  const entries: Array<{ level: LogLevel; entry: StructuredLogEntry }> = [];
  const logger = createLogger({
    service: 'api',
    fields: { env: 'test' },
    now: () => '2026-03-29T12:00:00.000Z',
    writer: {
      write(level, entry) {
        entries.push({ level, entry });
      },
    },
  });

  logger.child({ correlationId: 'corr-123' }).info('request complete', { statusCode: 200 });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.level, 'info');
  assert.deepEqual(entries[0]?.entry, {
    timestamp: '2026-03-29T12:00:00.000Z',
    level: 'info',
    service: 'api',
    message: 'request complete',
    env: 'test',
    correlationId: 'corr-123',
    statusCode: 200,
  });
});

test('logger error serializes error objects consistently', () => {
  const entries: StructuredLogEntry[] = [];
  const logger = createLogger({
    service: 'worker',
    writer: {
      write(_level, entry) {
        entries.push(entry);
      },
    },
  });

  const error = new Error('watchdog tripped');
  logger.error('worker failed', error, { workerId: 'worker-dev' });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.message, 'worker failed');
  assert.equal(entries[0]?.workerId, 'worker-dev');
  assert.equal(
    (entries[0]?.error as { message?: string }).message,
    'watchdog tripped',
  );
});

test('getOrCreateCorrelationId prefers inbound headers', () => {
  assert.equal(
    getOrCreateCorrelationId({ 'x-correlation-id': ' inbound-correlation ' }),
    'inbound-correlation',
  );
});

test('createCorrelationId generates a UUID when no seed is provided', () => {
  const id = createCorrelationId();
  assert.match(id, /^[0-9a-f-]{36}$/i);
});

test('normalizeCorrelationId trims and bounds values', () => {
  const normalized = normalizeCorrelationId(`  ${'a'.repeat(160)}  `);
  assert.equal(normalized?.length, 128);
  assert.equal(normalized, 'a'.repeat(128));
  assert.equal(normalizeCorrelationId('   '), undefined);
});

test('createRequestLogFields returns a stable request context shape', () => {
  assert.deepEqual(
    createRequestLogFields({
      correlationId: 'corr-456',
      method: 'POST',
      path: '/api/submissions',
      remoteAddress: '127.0.0.1',
    }),
    {
      correlationId: 'corr-456',
      method: 'POST',
      path: '/api/submissions',
      remoteAddress: '127.0.0.1',
    },
  );
});

test('serializeError handles nested causes and plain objects', () => {
  const rootCause = new Error('db unavailable');
  const error = new Error('request failed', { cause: rootCause });

  assert.equal(
    (serializeError(error) as { cause?: { message?: string } }).cause?.message,
    'db unavailable',
  );
  assert.deepEqual(serializeError({ retries: 2, success: false }), {
    retries: 2,
    success: false,
  });
});

test('observability stack decision names the production telemetry surfaces', () => {
  assert.deepEqual(OBSERVABILITY_STACK_DECISION, {
    logs: 'loki',
    metrics: 'prometheus-json',
    errors: 'structured-error-events',
    dashboards: 'operator-web',
  });
});

test('createErrorCaptureEvent serializes errors with operation and correlation context', () => {
  const event = createErrorCaptureEvent(
    {
      service: 'api',
      operation: 'POST /api/submissions',
      severity: 'critical',
      correlationId: 'corr-605',
      error: new Error('db unavailable'),
      fields: { statusCode: 500 },
    },
    () => '2026-04-19T09:30:00.000Z',
  );

  assert.equal(event.timestamp, '2026-04-19T09:30:00.000Z');
  assert.equal(event.service, 'api');
  assert.equal(event.operation, 'POST /api/submissions');
  assert.equal(event.severity, 'critical');
  assert.equal(event.correlationId, 'corr-605');
  assert.equal((event.error as { message?: string }).message, 'db unavailable');
  assert.deepEqual(event.fields, { statusCode: 500 });
});

test('createErrorTracker sends normalized events to the configured sink', async () => {
  const memory = createMemoryErrorTrackingSink();
  const tracker = createErrorTracker({
    service: 'worker',
    sink: memory.sink,
    now: () => '2026-04-19T09:31:00.000Z',
  });

  const event = await tracker.captureException({
    operation: 'worker.autorun',
    error: new Error('delivery failed'),
    fields: { target: 'discord:canary' },
  });

  assert.equal(memory.events.length, 1);
  assert.equal(memory.events[0], event);
  assert.equal(event.service, 'worker');
  assert.equal(event.operation, 'worker.autorun');
  assert.deepEqual(event.fields, { target: 'discord:canary' });
});

// --- Loki log writer tests ---

function createMockEntry(service = 'test', level: LogLevel = 'info'): StructuredLogEntry {
  return {
    timestamp: '2026-03-31T12:00:00.000Z',
    level,
    service,
    message: 'test message',
  };
}

test('createLokiLogWriter batches entries and flushes at threshold', async () => {
  const pushed: Array<{ body: string }> = [];
  const mockFetch = async (url: string, init: RequestInit) => {
    pushed.push({ body: init.body as string });
    return new Response('', { status: 204 });
  };

  const writer = createLokiLogWriter({
    url: 'http://localhost:3100',
    batchSize: 3,
    flushIntervalMs: 60000,
    fetchImpl: mockFetch as unknown as typeof fetch,
  });

  writer.write('info', createMockEntry('api', 'info'));
  writer.write('warn', createMockEntry('api', 'warn'));
  assert.equal(pushed.length, 0, 'should not flush before batch size');

  writer.write('error', createMockEntry('api', 'error'));
  // Allow async flush to complete
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(pushed.length, 1, 'should flush at batch size');

  const body = JSON.parse(pushed[0]!.body) as { streams: Array<{ stream: Record<string, string>; values: string[][] }> };
  assert.ok(body.streams.length > 0, 'should have at least one stream');

  writer.stop();
});

test('createLokiLogWriter handles push failure gracefully', async () => {
  const mockFetch = async () => {
    throw new Error('network down');
  };

  const writer = createLokiLogWriter({
    url: 'http://localhost:3100',
    batchSize: 1,
    flushIntervalMs: 60000,
    fetchImpl: mockFetch as unknown as typeof fetch,
  });

  // Should not throw
  writer.write('error', createMockEntry());
  await new Promise((r) => setTimeout(r, 50));

  writer.stop();
});

test('createDualLogWriter calls both writers', () => {
  const primaryEntries: StructuredLogEntry[] = [];
  const secondaryEntries: StructuredLogEntry[] = [];

  const primary: LogWriter = { write: (_l, e) => { primaryEntries.push(e); } };
  const secondary: LogWriter = { write: (_l, e) => { secondaryEntries.push(e); } };

  const dual = createDualLogWriter(primary, secondary);
  dual.write('info', createMockEntry());

  assert.equal(primaryEntries.length, 1);
  assert.equal(secondaryEntries.length, 1);
});

test('createDualLogWriter continues if secondary fails', () => {
  const primaryEntries: StructuredLogEntry[] = [];
  const primary: LogWriter = { write: (_l, e) => { primaryEntries.push(e); } };
  const secondary: LogWriter = { write: () => { throw new Error('secondary broken'); } };

  const dual = createDualLogWriter(primary, secondary);
  dual.write('info', createMockEntry());

  assert.equal(primaryEntries.length, 1, 'primary should still receive entry');
});

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

describe('MetricsCollector', () => {
  it('createMetricsCollector returns a MetricsCollector instance', () => {
    const collector = createMetricsCollector();
    assert.ok(collector instanceof MetricsCollector);
  });

  it('increment increases counter by 1 each call', () => {
    const collector = createMetricsCollector();
    collector.increment('api_requests_total');
    collector.increment('api_requests_total');
    collector.increment('api_requests_total');
    const snap = collector.snapshot();
    assert.deepStrictEqual(snap.counters['api_requests_total'], [
      { value: 3, labels: {} },
    ]);
  });

  it('increment with labels tracks separately', () => {
    const collector = createMetricsCollector();
    collector.increment('api_requests_total', { method: 'GET' });
    collector.increment('api_requests_total', { method: 'POST' });
    collector.increment('api_requests_total', { method: 'GET' });
    const snap = collector.snapshot();
    const entries = snap.counters['api_requests_total']!;
    assert.equal(entries.length, 2);
    const getEntry = entries.find((e) => e.labels.method === 'GET');
    const postEntry = entries.find((e) => e.labels.method === 'POST');
    assert.equal(getEntry?.value, 2);
    assert.equal(postEntry?.value, 1);
  });

  it('gauge sets and overwrites value', () => {
    const collector = createMetricsCollector();
    collector.gauge('uptime_seconds', 10);
    collector.gauge('uptime_seconds', 20);
    const snap = collector.snapshot();
    assert.deepStrictEqual(snap.gauges['uptime_seconds'], [
      { value: 20, labels: {} },
    ]);
  });

  it('gauge with labels tracks separately', () => {
    const collector = createMetricsCollector();
    collector.gauge('memory_mb', 100, { process: 'api' });
    collector.gauge('memory_mb', 200, { process: 'worker' });
    const snap = collector.snapshot();
    const entries = snap.gauges['memory_mb']!;
    assert.equal(entries.length, 2);
  });

  it('histogram records count, sum, and bucket distribution', () => {
    const collector = createMetricsCollector();
    collector.histogram('api_request_duration_ms', 15);
    collector.histogram('api_request_duration_ms', 150);
    collector.histogram('api_request_duration_ms', 3000);
    const snap = collector.snapshot();
    const entries = snap.histograms['api_request_duration_ms']!;
    assert.equal(entries.length, 1);
    const h = entries[0]!;
    assert.equal(h.count, 3);
    assert.equal(h.sum, 15 + 150 + 3000);
    assert.equal(h.buckets['5'], 0);
    assert.equal(h.buckets['10'], 0);
    assert.equal(h.buckets['25'], 1);
    assert.equal(h.buckets['50'], 1);
    assert.equal(h.buckets['100'], 1);
    assert.equal(h.buckets['250'], 2);
    assert.equal(h.buckets['500'], 2);
    assert.equal(h.buckets['1000'], 2);
    assert.equal(h.buckets['2500'], 2);
    assert.equal(h.buckets['5000'], 3);
  });

  it('snapshot returns empty when no metrics recorded', () => {
    const collector = createMetricsCollector();
    const snap = collector.snapshot();
    assert.deepStrictEqual(snap, { counters: {}, gauges: {}, histograms: {} });
  });

  it('snapshot returns copies (not live references)', () => {
    const collector = createMetricsCollector();
    collector.increment('test_counter');
    const snap1 = collector.snapshot();
    collector.increment('test_counter');
    const snap2 = collector.snapshot();
    assert.equal(snap1.counters['test_counter']![0]!.value, 1);
    assert.equal(snap2.counters['test_counter']![0]!.value, 2);
  });

  it('custom buckets are respected', () => {
    const collector = createMetricsCollector([10, 100, 1000]);
    collector.histogram('custom', 50);
    const snap = collector.snapshot();
    const h = snap.histograms['custom']![0]!;
    assert.equal(h.buckets['10'], 0);
    assert.equal(h.buckets['100'], 1);
    assert.equal(h.buckets['1000'], 1);
    assert.equal(Object.keys(h.buckets).length, 3);
  });
});
