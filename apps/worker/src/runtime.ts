import { loadEnvironment, type AppEnv } from '@unit-talk/config';
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
  simulationMode: boolean;
}

export function createWorkerRuntimeDependencies(
  options: { environment?: AppEnv } = {},
): WorkerRuntimeDependencies {
  const environment = options.environment ?? loadEnvironment();

  if (!hasDatabaseEnvironment(environment)) {
    return {
      repositories: createInMemoryRepositoryBundle(),
      persistenceMode: 'in_memory',
      workerId: readWorkerId(environment),
      distributionTargets: readDistributionTargets(environment),
      adapterKind: readAdapterKind(environment),
      pollIntervalMs: readPollIntervalMs(environment),
      maxCyclesPerRun: readMaxCyclesPerRun(environment),
      staleClaimMs: readStaleClaimMs(environment),
      heartbeatMs: readHeartbeatMs(environment),
      watchdogMs: readWatchdogMs(environment),
      dryRun: readDryRun(environment),
      autorun: readAutorun(environment),
      simulationMode: readSimulationMode(environment),
    };
  }

  const connection = createServiceRoleDatabaseConnectionConfig(environment);

  return {
    repositories: createDatabaseRepositoryBundle(connection),
    persistenceMode: 'database',
    workerId: readWorkerId(environment),
    distributionTargets: readDistributionTargets(environment),
    adapterKind: readAdapterKind(environment),
    pollIntervalMs: readPollIntervalMs(environment),
    maxCyclesPerRun: readMaxCyclesPerRun(environment),
    staleClaimMs: readStaleClaimMs(environment),
    heartbeatMs: readHeartbeatMs(environment),
    watchdogMs: readWatchdogMs(environment),
    dryRun: readDryRun(environment),
    autorun: readAutorun(environment),
    simulationMode: readSimulationMode(environment),
  };
}

function hasDatabaseEnvironment(environment: AppEnv) {
  return Boolean(
    environment.SUPABASE_URL &&
      environment.SUPABASE_ANON_KEY &&
      environment.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function readWorkerId(environment: AppEnv) {
  return environment.UNIT_TALK_WORKER_ID?.trim() || 'worker-dev';
}

function readDistributionTargets(environment: AppEnv) {
  const rawTargets = environment.UNIT_TALK_DISTRIBUTION_TARGETS?.trim() || 'discord:canary';

  return rawTargets
    .split(',')
    .map((target) => target.trim())
    .filter((target) => target.length > 0);
}

function readPollIntervalMs(environment: AppEnv) {
  const parsed = Number.parseInt(environment.UNIT_TALK_WORKER_POLL_MS ?? '5000', 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 5000;
  }

  return parsed;
}

function readMaxCyclesPerRun(environment: AppEnv) {
  const parsed = Number.parseInt(environment.UNIT_TALK_WORKER_MAX_CYCLES ?? '1', 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 1;
  }

  return parsed;
}

function readStaleClaimMs(environment: AppEnv) {
  const parsed = Number.parseInt(environment.UNIT_TALK_WORKER_STALE_CLAIM_MS ?? '300000', 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 300000;
  }

  return parsed;
}

function readHeartbeatMs(environment: AppEnv) {
  const parsed = Number.parseInt(environment.UNIT_TALK_WORKER_HEARTBEAT_MS ?? '5000', 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 5000;
  }

  return parsed;
}

function readWatchdogMs(environment: AppEnv) {
  const parsed = Number.parseInt(environment.UNIT_TALK_WORKER_WATCHDOG_MS ?? '30000', 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 30000;
  }

  return parsed;
}

function readDryRun(environment: AppEnv) {
  return environment.UNIT_TALK_WORKER_DRY_RUN !== 'false';
}

function readAutorun(environment: AppEnv) {
  return environment.UNIT_TALK_WORKER_AUTORUN === 'true';
}

function readAdapterKind(environment: AppEnv): 'stub' | 'discord' {
  return environment.UNIT_TALK_WORKER_ADAPTER === 'discord' ? 'discord' : 'stub';
}

export function readSimulationMode(environment: AppEnv = loadEnvironment()): boolean {
  return environment.UNIT_TALK_SIMULATION_MODE === 'true';
}

export function readCircuitBreakerThreshold(environment: AppEnv = loadEnvironment()): number {
  const parsed = Number.parseInt(
    environment.UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD ?? '5',
    10,
  );

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 5;
  }

  return parsed;
}

export function readCircuitBreakerCooldownMs(environment: AppEnv = loadEnvironment()): number {
  const parsed = Number.parseInt(
    environment.UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS ?? '300000',
    10,
  );

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 300_000;
  }

  return parsed;
}

export function readWorkerHeartbeatIntervalMs(
  environment: AppEnv = loadEnvironment(),
): number {
  const parsed = Number.parseInt(environment.WORKER_HEARTBEAT_INTERVAL_MS ?? '30000', 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    return 30000;
  }

  return parsed;
}
