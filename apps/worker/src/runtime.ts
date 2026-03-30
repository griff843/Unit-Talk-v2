import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createInMemoryRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';

export interface WorkerRuntimeDependencies {
  repositories: RepositoryBundle;
  persistenceMode: 'database' | 'in_memory';
  workerId: string;
  distributionTargets: string[];
  adapterKind: 'stub' | 'discord';
  pollIntervalMs: number;
  maxCyclesPerRun: number;
  staleClaimMs: number;
  heartbeatMs: number;
  watchdogMs: number;
  dryRun: boolean;
  autorun: boolean;
}

export function createWorkerRuntimeDependencies(): WorkerRuntimeDependencies {
  if (!hasDatabaseEnvironment()) {
    return {
      repositories: createInMemoryRepositoryBundle(),
      persistenceMode: 'in_memory',
      workerId: readWorkerId(),
      distributionTargets: readDistributionTargets(),
      adapterKind: readAdapterKind(),
      pollIntervalMs: readPollIntervalMs(),
      maxCyclesPerRun: readMaxCyclesPerRun(),
      staleClaimMs: readStaleClaimMs(),
      heartbeatMs: readHeartbeatMs(),
      watchdogMs: readWatchdogMs(),
      dryRun: readDryRun(),
      autorun: readAutorun(),
    };
  }

  const environment = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(environment);

  return {
    repositories: createDatabaseRepositoryBundle(connection),
    persistenceMode: 'database',
    workerId: readWorkerId(),
    distributionTargets: readDistributionTargets(),
    adapterKind: readAdapterKind(),
    pollIntervalMs: readPollIntervalMs(),
    maxCyclesPerRun: readMaxCyclesPerRun(),
    staleClaimMs: readStaleClaimMs(),
    heartbeatMs: readHeartbeatMs(),
    watchdogMs: readWatchdogMs(),
    dryRun: readDryRun(),
    autorun: readAutorun(),
  };
}

function hasDatabaseEnvironment() {
  try {
    const environment = loadEnvironment();
    return Boolean(
      environment.SUPABASE_URL &&
        environment.SUPABASE_ANON_KEY &&
        environment.SUPABASE_SERVICE_ROLE_KEY,
    );
  } catch {
    return false;
  }
}

function readWorkerId() {
  return process.env.UNIT_TALK_WORKER_ID?.trim() || 'worker-dev';
}

function readDistributionTargets() {
  const rawTargets =
    process.env.UNIT_TALK_DISTRIBUTION_TARGETS?.trim() || 'discord:canary';

  return rawTargets
    .split(',')
    .map((target) => target.trim())
    .filter((target) => target.length > 0);
}

function readPollIntervalMs() {
  const parsed = Number.parseInt(process.env.UNIT_TALK_WORKER_POLL_MS ?? '5000', 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 5000;
  }

  return parsed;
}

function readMaxCyclesPerRun() {
  const parsed = Number.parseInt(process.env.UNIT_TALK_WORKER_MAX_CYCLES ?? '1', 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 1;
  }

  return parsed;
}

function readStaleClaimMs() {
  const parsed = Number.parseInt(process.env.UNIT_TALK_WORKER_STALE_CLAIM_MS ?? '300000', 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 300000;
  }

  return parsed;
}

function readHeartbeatMs() {
  const parsed = Number.parseInt(process.env.UNIT_TALK_WORKER_HEARTBEAT_MS ?? '5000', 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 5000;
  }

  return parsed;
}

function readWatchdogMs() {
  const parsed = Number.parseInt(process.env.UNIT_TALK_WORKER_WATCHDOG_MS ?? '30000', 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 30000;
  }

  return parsed;
}

function readDryRun() {
  return process.env.UNIT_TALK_WORKER_DRY_RUN !== 'false';
}

function readAutorun() {
  return process.env.UNIT_TALK_WORKER_AUTORUN === 'true';
}

function readAdapterKind(): 'stub' | 'discord' {
  return process.env.UNIT_TALK_WORKER_ADAPTER === 'discord' ? 'discord' : 'stub';
}

export function readCircuitBreakerThreshold(): number {
  const parsed = Number.parseInt(
    process.env.UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD ?? '5',
    10,
  );

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 5;
  }

  return parsed;
}

export function readCircuitBreakerCooldownMs(): number {
  const parsed = Number.parseInt(
    process.env.UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS ?? '300000',
    10,
  );

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 300_000;
  }

  return parsed;
}

export function readWorkerHeartbeatIntervalMs(): number {
  const parsed = Number.parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? '30000', 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    return 30000;
  }

  return parsed;
}
