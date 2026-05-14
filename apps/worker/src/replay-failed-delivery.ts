import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { pathToFileURL } from 'node:url';

const DEFAULT_LIMIT = 10;
const MAX_REPLAY_LIMIT = 50;
const DEFAULT_MIN_AGE_HOURS = 1;
const LIVE_TARGETS = ['discord:canary', 'discord:best-bets'] as const;

export type ReplayTarget = (typeof LIVE_TARGETS)[number] | 'all';

export interface ReplayOptions {
  limit: number;
  dryRun: boolean;
  minAgeHours: number;
  target: ReplayTarget;
}

export interface ReplayAuditLog {
  service: 'replay-failed-delivery';
  replayed: number;
  skipped: number;
  errors: string[];
  durationMs: number;
}

interface FailedOutboxRow {
  id: string;
  target: string;
  attempt_count: number;
  metadata?: unknown;
  [key: string]: unknown;
}

interface QueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

interface MutationResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface SelectQuery<T> extends PromiseLike<QueryResult<T>> {
  eq(column: string, value: unknown): SelectQuery<T>;
  in(column: string, values: readonly unknown[]): SelectQuery<T>;
  lt(column: string, value: unknown): SelectQuery<T>;
  order(column: string, options: { ascending: boolean }): SelectQuery<T>;
  limit(count: number): SelectQuery<T>;
}

interface UpdateQuery<T> extends PromiseLike<MutationResult<T>> {
  eq(column: string, value: unknown): UpdateQuery<T>;
  select(columns?: string): UpdateQuery<T>;
  single(): UpdateQuery<T>;
}

export interface ReplayDatabaseClient {
  from(table: 'distribution_outbox'): {
    select(columns: string): SelectQuery<FailedOutboxRow>;
    update(values: Record<string, unknown>): UpdateQuery<FailedOutboxRow>;
  };
}

export function parseReplayArgs(argv: string[]): ReplayOptions {
  const options: ReplayOptions = {
    limit: DEFAULT_LIMIT,
    dryRun: false,
    minAgeHours: DEFAULT_MIN_AGE_HOURS,
    target: 'all',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (token === '--limit') {
      options.limit = readPositiveInteger(argv[index + 1], '--limit');
      index += 1;
      continue;
    }

    if (token?.startsWith('--limit=')) {
      options.limit = readPositiveInteger(token.slice('--limit='.length), '--limit');
      continue;
    }

    if (token === '--min-age-hours') {
      options.minAgeHours = readNonNegativeNumber(argv[index + 1], '--min-age-hours');
      index += 1;
      continue;
    }

    if (token?.startsWith('--min-age-hours=')) {
      options.minAgeHours = readNonNegativeNumber(
        token.slice('--min-age-hours='.length),
        '--min-age-hours',
      );
      continue;
    }

    if (token === '--target') {
      options.target = readTarget(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token?.startsWith('--target=')) {
      options.target = readTarget(token.slice('--target='.length));
      continue;
    }

    throw new Error(`Unsupported argument: ${token ?? '(missing)'}`);
  }

  if (options.limit > MAX_REPLAY_LIMIT) {
    throw new Error(`--limit must be ${MAX_REPLAY_LIMIT} or less`);
  }

  return options;
}

export async function replayFailedDeliveries(
  db: ReplayDatabaseClient,
  options: ReplayOptions,
  now: Date = new Date(),
): Promise<ReplayAuditLog | FailedOutboxRow[]> {
  if (options.limit > MAX_REPLAY_LIMIT) {
    throw new Error(`Refusing to process more than ${MAX_REPLAY_LIMIT} rows`);
  }

  const startedAt = Date.now();
  const cutoff = new Date(now.getTime() - options.minAgeHours * 60 * 60 * 1000).toISOString();
  let query = db
    .from('distribution_outbox')
    .select(
      'id,pick_id,target,status,attempt_count,last_error,created_at,updated_at',
    )
    .eq('status', 'failed')
    .lt('updated_at', cutoff);

  if (options.target !== 'all') {
    query = query.eq('target', options.target);
  } else {
    query = query.in('target', LIVE_TARGETS);
  }

  query = query.order('updated_at', { ascending: true }).limit(MAX_REPLAY_LIMIT + 1);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to read failed outbox rows: ${error.message}`);
  }

  const rows = data ?? [];
  if (rows.length > MAX_REPLAY_LIMIT) {
    throw new Error(`Refusing to process more than ${MAX_REPLAY_LIMIT} rows`);
  }

  const selectedRows = rows.slice(0, options.limit);
  if (options.dryRun) {
    return selectedRows;
  }

  const replayAt = now.toISOString();
  const errors: string[] = [];
  let replayed = 0;

  for (const row of selectedRows) {
    const { data: updated, error: updateError } = await db
      .from('distribution_outbox')
      .update({
        status: 'pending',
        last_error: null,
        attempt_count: row.attempt_count + 1,
      })
      .eq('id', row.id)
      .eq('status', 'failed')
      .select()
      .single();

    if (updateError || !updated) {
      errors.push(`Failed to replay outbox ${row.id}: ${updateError?.message ?? 'no row returned'}`);
      continue;
    }

    replayed += 1;
  }

  return {
    service: 'replay-failed-delivery',
    replayed,
    skipped: selectedRows.length - replayed,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

export async function runReplayFailedDeliveryCli(
  argv: string[],
  stdout: Pick<NodeJS.WriteStream, 'write'> = process.stdout,
  stderr: Pick<NodeJS.WriteStream, 'write'> = process.stderr,
): Promise<number> {
  try {
    const options = parseReplayArgs(argv);
    const env = loadEnvironment();
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    const db = createDatabaseClientFromConnection(connection);
    const result = await replayFailedDeliveries(db as unknown as ReplayDatabaseClient, options);

    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!Array.isArray(result) && result.errors.length > 0) {
      return 1;
    }
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function readPositiveInteger(value: string | undefined, name: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function readNonNegativeNumber(value: string | undefined, name: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function readTarget(value: string | undefined): ReplayTarget {
  if (value === 'all' || value === 'discord:canary' || value === 'discord:best-bets') {
    return value;
  }
  throw new Error('--target must be discord:canary, discord:best-bets, or all');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runReplayFailedDeliveryCli(process.argv.slice(2));
}
