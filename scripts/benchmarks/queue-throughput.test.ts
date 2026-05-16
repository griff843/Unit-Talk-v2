import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBenchmarkOptions,
  runQueueThroughputBenchmark,
  validateBenchmarkSummary,
  type QueueBenchmarkOptions,
  type QueueBenchmarkSummary,
} from './queue-throughput.js';

function fixedRandom(sequence: number[]): () => number {
  let index = 0;
  return () => {
    const value = sequence[Math.min(index, sequence.length - 1)] ?? 0.5;
    index += 1;
    return value;
  };
}

function makeSummary(overrides: Partial<QueueBenchmarkSummary> = {}): QueueBenchmarkSummary {
  return {
    service: 'queue-throughput-benchmark',
    mode: 'dry-run',
    queue_name: 'distribution_outbox',
    started_at: '2026-05-16T00:00:00.000Z',
    finished_at: '2026-05-16T00:00:01.000Z',
    duration_ms: 1_000,
    safety: {
      database_url_present: false,
      live_execution_requested: false,
      production_guard_triggered: false,
    },
    inputs: {
      batch_size: 10,
      worker_count: 2,
      claims_per_worker: 5,
      retry_rate: 0.1,
      dead_letter_rate: 0.1,
    },
    metrics: {
      inserted_rows: 10,
      claimed_rows: 10,
      processed_rows: 9,
      retries: 1,
      dead_letters: 1,
      pending_rows: 1,
      contention_ratio: 0,
      claim_latency_ms: {
        min: 10,
        avg: 12,
        p95: 15,
        max: 16,
      },
      processing_throughput_rows_per_sec: 9,
      retry_rate: 0.1,
      dead_letter_rate: 0.1,
    },
    notes: ['dry-run'],
    ...overrides,
  };
}

test('buildBenchmarkOptions defaults to dry-run when DATABASE_URL is absent', () => {
  const options = buildBenchmarkOptions([], {});
  assert.equal(options.dryRun, true);
  assert.equal(options.databaseUrl, undefined);
  assert.equal(options.queueName, 'distribution_outbox');
  assert.equal(options.batchSize, 200);
});

test('buildBenchmarkOptions requires explicit live intent when DATABASE_URL is present', () => {
  const options = buildBenchmarkOptions([], { DATABASE_URL: 'postgresql://bench@localhost:5432/unit_talk' });
  assert.equal(options.dryRun, true);
  assert.equal(options.databaseUrl, 'postgresql://bench@localhost:5432/unit_talk');
});

test('validateBenchmarkSummary accepts a valid summary', () => {
  assert.deepEqual(validateBenchmarkSummary(makeSummary()), []);
});

test('validateBenchmarkSummary rejects invalid metric ranges', () => {
  const issues = validateBenchmarkSummary(
    makeSummary({
      metrics: {
        ...makeSummary().metrics,
        claimed_rows: 12,
        retry_rate: 1.4,
      },
    }),
  );

  assert.match(issues.join('\n'), /claimed_rows must be between 0 and inserted_rows/);
  assert.match(issues.join('\n'), /retry_rate must be between 0 and 1/);
});

test('runQueueThroughputBenchmark dry-run emits validated JSON-safe metrics', async () => {
  const options: QueueBenchmarkOptions = buildBenchmarkOptions(
    ['--batch-size=6', '--worker-count=2', '--claims-per-worker=3', '--retry-rate=0.2', '--dead-letter-rate=0.2'],
    {},
  );

  const summary = await runQueueThroughputBenchmark(options, {
    now: () => new Date('2026-05-16T12:00:00.000Z'),
    random: fixedRandom([
      0.1, 0.05,
      0.2, 0.35,
      0.4, 0.9,
      0.6, 0.15,
      0.8, 0.7,
      0.3, 0.95,
    ]),
  });

  assert.equal(summary.mode, 'dry-run');
  assert.equal(summary.metrics.inserted_rows, 6);
  assert.equal(summary.metrics.claimed_rows, 6);
  assert.equal(summary.metrics.dead_letters, 2);
  assert.equal(summary.metrics.retries, 1);
  assert.equal(summary.metrics.processed_rows, 4);
  assert.ok(summary.metrics.claim_latency_ms.min >= 0);
  assert.ok(summary.metrics.claim_latency_ms.p95 <= summary.metrics.claim_latency_ms.max);
  assert.deepEqual(validateBenchmarkSummary(summary), []);
  assert.doesNotThrow(() => JSON.stringify(summary));
});

test('runQueueThroughputBenchmark live mode rejects production DATABASE_URL values', async () => {
  const options = buildBenchmarkOptions(
    ['--live'],
    {
      DATABASE_URL: 'postgresql://postgres:secret@db.zfzdnfwdarxucxtaojxm.supabase.co:5432/postgres',
    },
  );

  await assert.rejects(
    async () => runQueueThroughputBenchmark(options),
    /Refusing live benchmark against production Supabase project/,
  );
});
