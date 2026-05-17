import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvironment, type AppEnv } from '@unit-talk/config';
import {
  evaluateIngestorOutageHealth,
  type IngestorHealthStatus,
} from '../../apps/ingestor/src/staleness.js';

export interface IngestorContainerStatus {
  running: boolean;
  healthy: boolean;
  psOutput: string;
  status: string | null;
  startedAt: string | null;
}

export interface IngestorHealthResult {
  healthy: boolean;
  status: IngestorHealthStatus;
  containerRunning: boolean;
  runtimeRunning: boolean;
  outage: boolean;
  dataStale: boolean;
  offerAgeMinutes: number;
  staleThresholdMinutes: number;
  latestOfferUpdatedAt: string | null;
  latestRunStartedAt: string | null;
  summary: string;
  staleSince?: string;
}

const DEFAULT_STALE_MINUTES = 30;
const UNKNOWN_OFFER_AGE_MINUTES = Number.MAX_SAFE_INTEGER;

export function parseHealthThreshold(value: string | undefined, fallback = DEFAULT_STALE_MINUTES) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readIngestorContainerStatus(): IngestorContainerStatus {
  const psOutputResult = spawnSync(
    'docker',
    ['ps', '--filter', 'name=ingestor'],
    { encoding: 'utf8' },
  );
  const parseResult = spawnSync(
    'docker',
    [
      'ps',
      '--filter',
      'name=ingestor',
      '--format',
      '{{.Names}}\t{{.Status}}',
    ],
    { encoding: 'utf8' },
  );

  if (psOutputResult.error || psOutputResult.status !== 0 || parseResult.error || parseResult.status !== 0) {
    const error = psOutputResult.error ?? parseResult.error;
    return {
      running: false,
      healthy: false,
      psOutput:
        psOutputResult.stderr.trim() ||
        parseResult.stderr.trim() ||
        (error instanceof Error ? error.message : ''),
      status: null,
      startedAt: null,
    };
  }

  const psOutput = psOutputResult.stdout.trim();
  const rows = parseResult.stdout.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const runningRows = rows.filter((line) => /\bUp\b/i.test(line));
  const healthyRows = runningRows.filter(
    (line) => !/\bunhealthy\b/i.test(line) && (!/\bhealth:/i.test(line) || /\bhealthy\b/i.test(line)),
  );
  const containerName = runningRows[0]?.split('\t')[0] ?? rows[0]?.split('\t')[0] ?? null;

  return {
    running: runningRows.length > 0,
    healthy: healthyRows.length > 0,
    psOutput,
    status: runningRows[0]?.split('\t')[1] ?? rows[0]?.split('\t')[1] ?? null,
    startedAt: containerName ? readContainerStartedAt(containerName) : null,
  };
}

function readContainerStartedAt(containerName: string) {
  const result = spawnSync(
    'docker',
    ['inspect', '--format', '{{.State.StartedAt}}', containerName],
    { encoding: 'utf8' },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  const startedAt = result.stdout.trim();
  return startedAt.length > 0 && !startedAt.startsWith('0001-') ? startedAt : null;
}

export async function readLatestProviderOfferUpdatedAt(environment: Pick<
  AppEnv,
  'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'
>): Promise<string | null> {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  const db = createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await db
    .from('provider_offers')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`provider_offers freshness query failed: ${error.message}`);
  }

  return typeof data?.[0]?.updated_at === 'string' ? data[0].updated_at : null;
}

export async function readLatestIngestorRunStartedAt(environment: Pick<
  AppEnv,
  'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'
>): Promise<string | null> {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  const db = createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await db
    .from('system_runs')
    .select('started_at')
    .eq('run_type', 'ingestor.cycle')
    .order('started_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`system_runs ingestor freshness query failed: ${error.message}`);
  }

  return typeof data?.[0]?.started_at === 'string' ? data[0].started_at : null;
}

export function evaluateIngestorHealthCheck(input: {
  container: Pick<IngestorContainerStatus, 'running' | 'healthy'>;
  latestOfferUpdatedAt: string | null;
  latestRunStartedAt: string | null;
  staleThresholdMinutes?: number;
  now?: Date;
}): IngestorHealthResult {
  const staleThresholdMinutes = input.staleThresholdMinutes ?? DEFAULT_STALE_MINUTES;
  const runtimeRunning = input.container.running && input.container.healthy;
  const health = evaluateIngestorOutageHealth({
    runtimeRunning,
    latestRunStartedAt: input.latestRunStartedAt,
    latestOfferUpdatedAt: input.latestOfferUpdatedAt,
    staleThresholdMinutes,
    now: input.now,
  });

  return {
    healthy: health.status === 'HEALTHY',
    status: health.status,
    containerRunning: input.container.running,
    runtimeRunning,
    outage: health.outage,
    dataStale: health.dataStale,
    offerAgeMinutes: health.ageMinutes ?? UNKNOWN_OFFER_AGE_MINUTES,
    staleThresholdMinutes: health.staleThresholdMinutes,
    latestOfferUpdatedAt: health.latestOfferUpdatedAt,
    latestRunStartedAt: health.latestRunStartedAt,
    summary: health.summary,
    ...(health.staleSince ? { staleSince: health.staleSince } : {}),
  };
}

export async function collectIngestorHealthCheck(options: {
  environment?: Pick<AppEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY' | 'UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES'>;
  now?: Date;
} = {}): Promise<IngestorHealthResult> {
  const environment = options.environment ?? loadEnvironment();
  const container = readIngestorContainerStatus();
  const [latestOfferUpdatedAt, latestRunStartedAt] = await Promise.all([
    readLatestProviderOfferUpdatedAt(environment),
    readLatestIngestorRunStartedAt(environment),
  ]);
  const staleThresholdMinutes = parseHealthThreshold(environment.UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES);

  return evaluateIngestorHealthCheck({
    container,
    latestOfferUpdatedAt,
    latestRunStartedAt,
    staleThresholdMinutes,
    now: options.now,
  });
}

async function main() {
  const health = await collectIngestorHealthCheck();
  console.log(JSON.stringify(health));
  process.exit(health.healthy ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const health: IngestorHealthResult = {
      healthy: false,
      status: 'FAILED',
      containerRunning: false,
      runtimeRunning: false,
      outage: true,
      dataStale: true,
      offerAgeMinutes: UNKNOWN_OFFER_AGE_MINUTES,
      staleThresholdMinutes: DEFAULT_STALE_MINUTES,
      latestOfferUpdatedAt: null,
      latestRunStartedAt: null,
      summary: 'Ingestor health check failed before runtime state could be proven.',
      staleSince: new Date().toISOString(),
    };
    console.error(error instanceof Error ? error.message : String(error));
    console.log(JSON.stringify(health));
    process.exit(1);
  });
}
