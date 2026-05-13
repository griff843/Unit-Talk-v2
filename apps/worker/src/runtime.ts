import {
  RuntimeConfigError,
  assertProductionRuntimeConfig,
  loadEnvironment,
  type AppEnv,
  type RuntimeMode,
} from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createInMemoryRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import {
  evaluateWorkerTargetCoverage,
  formatWorkerTargetCoverageError,
  resolveTargetRegistry,
  type WorkerTargetCoverageReport,
} from '@unit-talk/contracts';

export interface WorkerRuntimeDependencies {
  repositories: RepositoryBundle;
  persistenceMode: 'database' | 'in_memory';
  runtimeMode: RuntimeMode;
  appVersion: string;
  workerId: string;
  distributionTargets: string[];
  adapterKind: 'stub' | 'discord';
  pollIntervalMs: number;
  maxCyclesPerRun: number;
  staleClaimMs: number;
  heartbeatMs: number;
  watchdogMs: number;
  workerHeartbeatIntervalMs: number;
  dryRun: boolean;
  autorun: boolean;
  simulationMode: boolean;
  targetCoverage: WorkerTargetCoverageReport;
}

export function createWorkerRuntimeDependencies(
  options: { environment?: AppEnv } = {},
): WorkerRuntimeDependencies {
  const environment = options.environment ?? loadEnvironment();
  const distributionTargets = readDistributionTargets(environment);
  const adapterKind = readAdapterKind(environment);
  const dryRun = readDryRun(environment);
  const persistenceMode = hasDatabaseEnvironment(environment)
    ? 'database'
    : 'in_memory';
  const startupConfig = assertProductionRuntimeConfig(environment, {
    service: 'worker',
    runtimeModeKey: 'UNIT_TALK_WORKER_RUNTIME_MODE',
    requiredKeys: [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'UNIT_TALK_WORKER_ID',
      'UNIT_TALK_WORKER_ADAPTER',
      'UNIT_TALK_DISTRIBUTION_TARGETS',
      'DISCORD_BOT_TOKEN',
      'UNIT_TALK_DISCORD_TARGET_MAP',
    ],
    persistenceMode,
    dryRun,
    workerTargets: distributionTargets,
  });
  const targetCoverage = evaluateWorkerTargetCoverage({
    registry: resolveTargetRegistry(environment),
    workerTargets: distributionTargets,
    appEnv: environment.UNIT_TALK_APP_ENV,
  });

  if (startupConfig.productionLike && !targetCoverage.ok) {
    throw new RuntimeConfigError({
      code: 'RUNTIME_REQUIRED_ENV_MISSING',
      service: 'worker',
      missingKeys: ['UNIT_TALK_DISTRIBUTION_TARGETS'],
      message:
        `worker target configuration does not cover enabled promotion targets: ` +
        formatWorkerTargetCoverageError(targetCoverage),
    });
  }

  if (startupConfig.productionLike && adapterKind !== 'discord') {
    throw new RuntimeConfigError({
      code: 'RUNTIME_REQUIRED_ENV_MISSING',
      service: 'worker',
      missingKeys: ['UNIT_TALK_WORKER_ADAPTER'],
      message:
        'worker production runtime requires UNIT_TALK_WORKER_ADAPTER=discord.',
    });
  }

  if (startupConfig.productionLike) {
    assertDiscordTargetMapCoversTargets(environment, distributionTargets);
  }

  if (persistenceMode === 'in_memory') {
    return {
      repositories: createInMemoryRepositoryBundle(),
      persistenceMode: 'in_memory',
      runtimeMode: startupConfig.runtimeMode,
      appVersion: startupConfig.appVersion,
      workerId: readWorkerId(environment),
      distributionTargets,
      adapterKind,
      pollIntervalMs: readPollIntervalMs(environment),
      maxCyclesPerRun: readMaxCyclesPerRun(environment),
      staleClaimMs: readStaleClaimMs(environment),
      heartbeatMs: readHeartbeatMs(environment),
      watchdogMs: readWatchdogMs(environment),
      workerHeartbeatIntervalMs: readWorkerHeartbeatIntervalMs(environment),
      dryRun,
      autorun: readAutorun(environment),
      simulationMode: readSimulationMode(environment),
      targetCoverage,
    };
  }

  const connection = createServiceRoleDatabaseConnectionConfig(environment);

  return {
    repositories: createDatabaseRepositoryBundle(connection),
    persistenceMode: 'database',
    runtimeMode: startupConfig.runtimeMode,
    appVersion: startupConfig.appVersion,
    workerId: readWorkerId(environment),
    distributionTargets,
    adapterKind,
    pollIntervalMs: readPollIntervalMs(environment),
    maxCyclesPerRun: readMaxCyclesPerRun(environment),
    staleClaimMs: readStaleClaimMs(environment),
    heartbeatMs: readHeartbeatMs(environment),
    watchdogMs: readWatchdogMs(environment),
    workerHeartbeatIntervalMs: readWorkerHeartbeatIntervalMs(environment),
    dryRun,
    autorun: readAutorun(environment),
    simulationMode: readSimulationMode(environment),
    targetCoverage,
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

function assertDiscordTargetMapCoversTargets(
  environment: AppEnv,
  distributionTargets: readonly string[],
) {
  const targetMap = readDiscordTargetMap(environment.UNIT_TALK_DISCORD_TARGET_MAP);
  const missingTargets = distributionTargets.filter(
    (target) => !targetMap[target] && !/^discord:\d+$/.test(target),
  );

  if (missingTargets.length > 0) {
    throw new RuntimeConfigError({
      code: 'RUNTIME_REQUIRED_ENV_MISSING',
      service: 'worker',
      missingKeys: ['UNIT_TALK_DISCORD_TARGET_MAP'],
      message: `worker production runtime is missing Discord channel mappings for targets: ${missingTargets.join(', ')}.`,
    });
  }
}

function readDiscordTargetMap(rawValue: string | undefined) {
  const raw = rawValue?.trim();
  if (!raw) {
    return {} as Record<string, string>;
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('UNIT_TALK_DISCORD_TARGET_MAP must be a JSON object.');
  }

  return parsed as Record<string, string>;
}

function readPollIntervalMs(environment: AppEnv) {
  const parsed = Number.parseInt(environment.UNIT_TALK_WORKER_POLL_MS ?? '5000', 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 5000;
  }

  return parsed;
}

function readMaxCyclesPerRun(environment: AppEnv) {
  const raw = environment.UNIT_TALK_WORKER_MAX_CYCLES;
  if (!raw) {
    return 0; // 0 = run indefinitely
  }

  const parsed = Number.parseInt(raw, 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    return 1;
  }

  return parsed; // 0 = run indefinitely
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
