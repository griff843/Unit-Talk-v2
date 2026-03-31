import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCorrelationId,
  createDualLogWriter,
  createLogger,
  createLokiLogWriter,
  createRequestLogFields,
  getOrCreateCorrelationId,
  normalizeCorrelationId,
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
