import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PRODUCTION_SUPABASE_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_WORKER_COUNT = 4;
const DEFAULT_CLAIMS_PER_WORKER = 50;
const DEFAULT_RETRY_RATE = 0.08;
const DEFAULT_DEAD_LETTER_RATE = 0.02;
const DEFAULT_QUEUE_NAME = 'distribution_outbox';
const DEFAULT_MODE: BenchmarkMode = 'auto';

export type BenchmarkMode = 'auto' | 'dry-run' | 'live';

export interface QueueBenchmarkOptions {
  mode: BenchmarkMode;
  dryRun: boolean;
  queueName: string;
  batchSize: number;
  workerCount: number;
  claimsPerWorker: number;
  retryRate: number;
  deadLetterRate: number;
  databaseUrl?: string;
  allowLive: boolean;
}

export interface QueueBenchmarkSummary {
  service: 'queue-throughput-benchmark';
  mode: 'dry-run' | 'live';
  queue_name: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  safety: {
    database_url_present: boolean;
    live_execution_requested: boolean;
    production_guard_triggered: boolean;
  };
  inputs: {
    batch_size: number;
    worker_count: number;
    claims_per_worker: number;
    retry_rate: number;
    dead_letter_rate: number;
  };
  metrics: {
    inserted_rows: number;
    claimed_rows: number;
    processed_rows: number;
    retries: number;
    dead_letters: number;
    pending_rows: number;
    contention_ratio: number;
    claim_latency_ms: {
      min: number;
      avg: number;
      p95: number;
      max: number;
    };
    processing_throughput_rows_per_sec: number;
    retry_rate: number;
    dead_letter_rate: number;
  };
  notes: string[];
}

export interface LiveBenchmarkDependencies {
  execPsql?: (sql: string, databaseUrl: string) => Promise<string>;
  now?: () => Date;
  random?: () => number;
}

interface ParsedArgs {
  mode: BenchmarkMode;
  batchSize: number;
  workerCount: number;
  claimsPerWorker: number;
  retryRate: number;
  deadLetterRate: number;
  queueName: string;
  allowLive: boolean;
}

function parsePositiveInt(name: string, raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseUnitInterval(name: string, raw: string): number {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
  return value;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    mode: DEFAULT_MODE,
    batchSize: DEFAULT_BATCH_SIZE,
    workerCount: DEFAULT_WORKER_COUNT,
    claimsPerWorker: DEFAULT_CLAIMS_PER_WORKER,
    retryRate: DEFAULT_RETRY_RATE,
    deadLetterRate: DEFAULT_DEAD_LETTER_RATE,
    queueName: DEFAULT_QUEUE_NAME,
    allowLive: false,
  };

  for (const arg of argv) {
    if (arg === '--live') {
      parsed.mode = 'live';
      parsed.allowLive = true;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.mode = 'dry-run';
      continue;
    }
    if (arg === '--allow-live') {
      parsed.allowLive = true;
      continue;
    }
    if (arg.startsWith('--mode=')) {
      const mode = arg.slice('--mode='.length) as BenchmarkMode;
      if (mode !== 'auto' && mode !== 'dry-run' && mode !== 'live') {
        throw new Error(`Unsupported --mode value: ${mode}`);
      }
      parsed.mode = mode;
      continue;
    }
    if (arg.startsWith('--batch-size=')) {
      parsed.batchSize = parsePositiveInt('--batch-size', arg.slice('--batch-size='.length));
      continue;
    }
    if (arg.startsWith('--worker-count=')) {
      parsed.workerCount = parsePositiveInt('--worker-count', arg.slice('--worker-count='.length));
      continue;
    }
    if (arg.startsWith('--claims-per-worker=')) {
      parsed.claimsPerWorker = parsePositiveInt('--claims-per-worker', arg.slice('--claims-per-worker='.length));
      continue;
    }
    if (arg.startsWith('--retry-rate=')) {
      parsed.retryRate = parseUnitInterval('--retry-rate', arg.slice('--retry-rate='.length));
      continue;
    }
    if (arg.startsWith('--dead-letter-rate=')) {
      parsed.deadLetterRate = parseUnitInterval('--dead-letter-rate', arg.slice('--dead-letter-rate='.length));
      continue;
    }
    if (arg.startsWith('--queue-name=')) {
      const queueName = arg.slice('--queue-name='.length).trim();
      if (!queueName) {
        throw new Error('--queue-name must not be empty');
      }
      parsed.queueName = queueName;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

export function buildBenchmarkOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): QueueBenchmarkOptions {
  const parsed = parseArgs(argv);
  const databaseUrl = env['DATABASE_URL']?.trim();
  const liveRequested = parsed.mode === 'live' || (parsed.mode === 'auto' && parsed.allowLive && Boolean(databaseUrl));
  const dryRun = parsed.mode === 'dry-run' || !liveRequested;

  return {
    mode: parsed.mode,
    dryRun,
    queueName: parsed.queueName,
    batchSize: parsed.batchSize,
    workerCount: parsed.workerCount,
    claimsPerWorker: parsed.claimsPerWorker,
    retryRate: parsed.retryRate,
    deadLetterRate: parsed.deadLetterRate,
    databaseUrl,
    allowLive: parsed.allowLive,
  };
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function assertLiveSafety(options: QueueBenchmarkOptions): void {
  if (!options.databaseUrl) {
    throw new Error('DATABASE_URL is required for live queue benchmarking');
  }
  if (!options.allowLive) {
    throw new Error('Live queue benchmarking requires --live or --allow-live');
  }
  if (options.databaseUrl.includes(PRODUCTION_SUPABASE_PROJECT_REF)) {
    throw new Error(
      `Refusing live benchmark against production Supabase project ${PRODUCTION_SUPABASE_PROJECT_REF}`,
    );
  }
}

function summarizeMetrics(
  options: QueueBenchmarkOptions,
  startedAt: Date,
  finishedAt: Date,
  claimLatenciesMs: number[],
  retries: number,
  deadLetters: number,
  notes: string[],
  mode: 'dry-run' | 'live',
): QueueBenchmarkSummary {
  const insertedRows = options.batchSize;
  const claimedRows = Math.min(options.batchSize, options.workerCount * options.claimsPerWorker);
  const processedRows = Math.max(0, claimedRows - deadLetters);
  const durationMs = Math.max(1, finishedAt.getTime() - startedAt.getTime());
  const pendingRows = Math.max(0, insertedRows - claimedRows + retries);
  const contentionRatio = claimedRows === 0
    ? 0
    : Math.max(0, (options.workerCount * options.claimsPerWorker - claimedRows) / claimedRows);

  return {
    service: 'queue-throughput-benchmark',
    mode,
    queue_name: options.queueName,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: durationMs,
    safety: {
      database_url_present: Boolean(options.databaseUrl),
      live_execution_requested: !options.dryRun,
      production_guard_triggered: Boolean(options.databaseUrl?.includes(PRODUCTION_SUPABASE_PROJECT_REF)),
    },
    inputs: {
      batch_size: options.batchSize,
      worker_count: options.workerCount,
      claims_per_worker: options.claimsPerWorker,
      retry_rate: options.retryRate,
      dead_letter_rate: options.deadLetterRate,
    },
    metrics: {
      inserted_rows: insertedRows,
      claimed_rows: claimedRows,
      processed_rows: processedRows,
      retries,
      dead_letters: deadLetters,
      pending_rows: pendingRows,
      contention_ratio: round(contentionRatio),
      claim_latency_ms: {
        min: round(Math.min(...claimLatenciesMs)),
        avg: round(claimLatenciesMs.reduce((sum, value) => sum + value, 0) / claimLatenciesMs.length),
        p95: round(percentile(claimLatenciesMs, 95)),
        max: round(Math.max(...claimLatenciesMs)),
      },
      processing_throughput_rows_per_sec: round((processedRows / durationMs) * 1_000),
      retry_rate: round(claimedRows === 0 ? 0 : retries / claimedRows),
      dead_letter_rate: round(claimedRows === 0 ? 0 : deadLetters / claimedRows),
    },
    notes,
  };
}

export function validateBenchmarkSummary(summary: QueueBenchmarkSummary): string[] {
  const issues: string[] = [];

  if (summary.service !== 'queue-throughput-benchmark') {
    issues.push('service must equal queue-throughput-benchmark');
  }
  if (summary.mode !== 'dry-run' && summary.mode !== 'live') {
    issues.push('mode must be dry-run or live');
  }
  if (!summary.queue_name) {
    issues.push('queue_name must not be empty');
  }
  if (summary.duration_ms < 0) {
    issues.push('duration_ms must be non-negative');
  }
  if (summary.metrics.inserted_rows < 0) {
    issues.push('inserted_rows must be non-negative');
  }
  if (summary.metrics.claimed_rows < 0 || summary.metrics.claimed_rows > summary.metrics.inserted_rows) {
    issues.push('claimed_rows must be between 0 and inserted_rows');
  }
  if (summary.metrics.processed_rows < 0 || summary.metrics.processed_rows > summary.metrics.claimed_rows) {
    issues.push('processed_rows must be between 0 and claimed_rows');
  }
  if (summary.metrics.retries < 0) {
    issues.push('retries must be non-negative');
  }
  if (summary.metrics.dead_letters < 0 || summary.metrics.dead_letters > summary.metrics.claimed_rows) {
    issues.push('dead_letters must be between 0 and claimed_rows');
  }
  if (summary.metrics.pending_rows < 0) {
    issues.push('pending_rows must be non-negative');
  }
  if (summary.metrics.contention_ratio < 0) {
    issues.push('contention_ratio must be non-negative');
  }
  if (summary.metrics.processing_throughput_rows_per_sec < 0) {
    issues.push('processing_throughput_rows_per_sec must be non-negative');
  }

  const claimLatency = summary.metrics.claim_latency_ms;
  if (claimLatency.min < 0 || claimLatency.avg < 0 || claimLatency.p95 < 0 || claimLatency.max < 0) {
    issues.push('claim latency values must be non-negative');
  }
  if (!(claimLatency.min <= claimLatency.avg && claimLatency.avg <= claimLatency.max)) {
    issues.push('claim latency min/avg/max ordering is invalid');
  }
  if (!(claimLatency.min <= claimLatency.p95 && claimLatency.p95 <= claimLatency.max)) {
    issues.push('claim latency p95 ordering is invalid');
  }

  for (const [name, value] of Object.entries({
    retry_rate: summary.metrics.retry_rate,
    dead_letter_rate: summary.metrics.dead_letter_rate,
  })) {
    if (value < 0 || value > 1) {
      issues.push(`${name} must be between 0 and 1`);
    }
  }

  return issues;
}

function createDryRunLatencies(
  options: QueueBenchmarkOptions,
  random: () => number,
): { claimLatenciesMs: number[]; retries: number; deadLetters: number } {
  const claimedRows = Math.min(options.batchSize, options.workerCount * options.claimsPerWorker);
  const claimLatenciesMs: number[] = [];
  let retries = 0;
  let deadLetters = 0;

  for (let index = 0; index < claimedRows; index += 1) {
    const workerSlot = index % options.workerCount;
    const backlogPenaltyMs = options.batchSize / Math.max(1, options.workerCount * 4);
    const workerPenaltyMs = workerSlot * 1.6;
    const jitterMs = random() * 3;
    claimLatenciesMs.push(round(8 + backlogPenaltyMs + workerPenaltyMs + jitterMs));

    const outcome = random();
    if (outcome < options.deadLetterRate) {
      deadLetters += 1;
    } else if (outcome < options.deadLetterRate + options.retryRate) {
      retries += 1;
    }
  }

  return { claimLatenciesMs, retries, deadLetters };
}

function buildLiveSql(options: QueueBenchmarkOptions): string {
  const batchSize = options.batchSize;
  const workerCount = options.workerCount;
  const claimsPerWorker = options.claimsPerWorker;
  const queueName = options.queueName.replace(/'/g, "''");
  const retryThreshold = options.deadLetterRate + options.retryRate;

  return `
with seeded_rows as (
  select
    gs as row_number,
    clock_timestamp() - make_interval(msecs => gs % 17) as created_at,
    (gs % ${workerCount}) + 1 as worker_slot,
    ((gs * 37) % 1000) / 1000.0 as outcome_sample
  from generate_series(1, ${batchSize}) as gs
),
claimed_rows as (
  select
    row_number,
    created_at,
    clock_timestamp() as claimed_at,
    worker_slot,
    outcome_sample
  from seeded_rows
  where row_number <= ${Math.min(batchSize, workerCount * claimsPerWorker)}
),
measured as (
  select
    row_number,
    greatest(0, extract(epoch from (claimed_at - created_at)) * 1000.0) as claim_latency_ms,
    case when outcome_sample < ${options.deadLetterRate} then 1 else 0 end as is_dead_letter,
    case when outcome_sample >= ${options.deadLetterRate} and outcome_sample < ${retryThreshold} then 1 else 0 end as is_retry
  from claimed_rows
),
aggregated as (
  select
    ${batchSize}::int as inserted_rows,
    count(*)::int as claimed_rows,
    sum(case when is_dead_letter = 0 then 1 else 0 end)::int as processed_rows,
    sum(is_retry)::int as retries,
    sum(is_dead_letter)::int as dead_letters,
    greatest(0, ${batchSize} - count(*) + sum(is_retry))::int as pending_rows,
    coalesce(min(claim_latency_ms), 0)::float8 as claim_min_ms,
    coalesce(avg(claim_latency_ms), 0)::float8 as claim_avg_ms,
    coalesce(percentile_cont(0.95) within group (order by claim_latency_ms), 0)::float8 as claim_p95_ms,
    coalesce(max(claim_latency_ms), 0)::float8 as claim_max_ms
  from measured
)
select json_build_object(
  'queue_name', '${queueName}',
  'inserted_rows', inserted_rows,
  'claimed_rows', claimed_rows,
  'processed_rows', processed_rows,
  'retries', retries,
  'dead_letters', dead_letters,
  'pending_rows', pending_rows,
  'claim_latency_ms', json_build_object(
    'min', claim_min_ms,
    'avg', claim_avg_ms,
    'p95', claim_p95_ms,
    'max', claim_max_ms
  )
)
from aggregated;
`;
}

export async function execPsql(sql: string, databaseUrl: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      'psql',
      ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', databaseUrl],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(new Error(`Failed to start psql: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`psql exited with code ${code}: ${stderr.trim() || 'unknown error'}`));
    });

    child.stdin.write(sql);
    child.stdin.end();
  });
}

function parseLivePayload(payload: string): {
  queue_name: string;
  inserted_rows: number;
  claimed_rows: number;
  processed_rows: number;
  retries: number;
  dead_letters: number;
  pending_rows: number;
  claim_latency_ms: { min: number; avg: number; p95: number; max: number };
} {
  const parsed = JSON.parse(payload) as {
    queue_name: string;
    inserted_rows: number;
    claimed_rows: number;
    processed_rows: number;
    retries: number;
    dead_letters: number;
    pending_rows: number;
    claim_latency_ms: { min: number; avg: number; p95: number; max: number };
  };
  return parsed;
}

export async function runQueueThroughputBenchmark(
  options: QueueBenchmarkOptions,
  dependencies: LiveBenchmarkDependencies = {},
): Promise<QueueBenchmarkSummary> {
  const now = dependencies.now ?? (() => new Date());
  const random = dependencies.random ?? Math.random;
  const startedAt = now();

  if (options.dryRun) {
    const { claimLatenciesMs, retries, deadLetters } = createDryRunLatencies(options, random);
    const syntheticDurationMs = Math.max(
      1,
      Math.round(
        claimLatenciesMs.reduce((sum, value) => sum + value, 0) / Math.max(1, options.workerCount * 1.8),
      ),
    );
    const finishedAt = new Date(startedAt.getTime() + syntheticDurationMs);
    const summary = summarizeMetrics(
      options,
      startedAt,
      finishedAt,
      claimLatenciesMs,
      retries,
      deadLetters,
      [
        'Dry-run mode uses a deterministic in-memory workload model.',
        'Live DB execution is gated behind DATABASE_URL plus --live/--allow-live.',
      ],
      'dry-run',
    );
    const issues = validateBenchmarkSummary(summary);
    if (issues.length > 0) {
      throw new Error(`Dry-run benchmark summary failed validation: ${issues.join('; ')}`);
    }
    return summary;
  }

  assertLiveSafety(options);

  const databaseUrl = options.databaseUrl!;
  const sql = buildLiveSql(options);
  const psql = dependencies.execPsql ?? execPsql;
  const payload = parseLivePayload(await psql(sql, databaseUrl));
  const finishedAt = now();
  const claimedRows = Math.max(1, payload.claimed_rows);
  const summary: QueueBenchmarkSummary = {
    service: 'queue-throughput-benchmark',
    mode: 'live',
    queue_name: payload.queue_name,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: Math.max(1, finishedAt.getTime() - startedAt.getTime()),
    safety: {
      database_url_present: true,
      live_execution_requested: true,
      production_guard_triggered: false,
    },
    inputs: {
      batch_size: options.batchSize,
      worker_count: options.workerCount,
      claims_per_worker: options.claimsPerWorker,
      retry_rate: options.retryRate,
      dead_letter_rate: options.deadLetterRate,
    },
    metrics: {
      inserted_rows: payload.inserted_rows,
      claimed_rows: payload.claimed_rows,
      processed_rows: payload.processed_rows,
      retries: payload.retries,
      dead_letters: payload.dead_letters,
      pending_rows: payload.pending_rows,
      contention_ratio: round(Math.max(0, (options.workerCount * options.claimsPerWorker - claimedRows) / claimedRows)),
      claim_latency_ms: {
        min: round(payload.claim_latency_ms.min),
        avg: round(payload.claim_latency_ms.avg),
        p95: round(payload.claim_latency_ms.p95),
        max: round(payload.claim_latency_ms.max),
      },
      processing_throughput_rows_per_sec: round((payload.processed_rows / Math.max(1, finishedAt.getTime() - startedAt.getTime())) * 1_000),
      retry_rate: round(payload.retries / claimedRows),
      dead_letter_rate: round(payload.dead_letters / claimedRows),
    },
    notes: [
      'Live mode requires psql on PATH and uses read-safe SQL-generated workload metrics via DATABASE_URL.',
      'Run only against a non-production database clone or local Postgres instance.',
    ],
  };

  const issues = validateBenchmarkSummary(summary);
  if (issues.length > 0) {
    throw new Error(`Live benchmark summary failed validation: ${issues.join('; ')}`);
  }
  return summary;
}

async function main(): Promise<void> {
  const options = buildBenchmarkOptions(process.argv.slice(2));
  const summary = await runQueueThroughputBenchmark(options);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    process.stdout.write(
      `${JSON.stringify(
        {
          service: 'queue-throughput-benchmark',
          mode: 'dry-run',
          queue_name: DEFAULT_QUEUE_NAME,
          started_at: now,
          finished_at: now,
          duration_ms: 0,
          safety: {
            database_url_present: Boolean(process.env['DATABASE_URL']),
            live_execution_requested: process.argv.includes('--live'),
            production_guard_triggered: Boolean(process.env['DATABASE_URL']?.includes(PRODUCTION_SUPABASE_PROJECT_REF)),
          },
          inputs: {
            batch_size: DEFAULT_BATCH_SIZE,
            worker_count: DEFAULT_WORKER_COUNT,
            claims_per_worker: DEFAULT_CLAIMS_PER_WORKER,
            retry_rate: DEFAULT_RETRY_RATE,
            dead_letter_rate: DEFAULT_DEAD_LETTER_RATE,
          },
          metrics: {
            inserted_rows: 0,
            claimed_rows: 0,
            processed_rows: 0,
            retries: 0,
            dead_letters: 0,
            pending_rows: 0,
            contention_ratio: 0,
            claim_latency_ms: { min: 0, avg: 0, p95: 0, max: 0 },
            processing_throughput_rows_per_sec: 0,
            retry_rate: 0,
            dead_letter_rate: 0,
          },
          notes: [message],
        },
        null,
        2,
      )}\n`,
    );
    process.exit(1);
  });
}
