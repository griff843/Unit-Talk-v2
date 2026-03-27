import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseIngestorRepositoryBundle,
  createInMemoryIngestorRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { parseConfiguredLeagues, runIngestorCycles } from './ingestor-runner.js';

function createIngestorRuntimeDependencies() {
  const env = loadEnvironment();
  const leagues = parseConfiguredLeagues(env.UNIT_TALK_INGESTOR_LEAGUES);
  const pollIntervalMs = parsePositiveInt(env.UNIT_TALK_INGESTOR_POLL_MS, 300_000);
  const configuredMaxCycles = parsePositiveInt(env.UNIT_TALK_INGESTOR_MAX_CYCLES, 1);
  const maxCycles = configuredMaxCycles === 0 ? undefined : configuredMaxCycles;
  const autorun = env.UNIT_TALK_INGESTOR_AUTORUN === 'true';
  const skipResults = env.UNIT_TALK_INGESTOR_SKIP_RESULTS === 'true';

  try {
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    return {
      persistenceMode: 'database' as const,
      repositories: createDatabaseIngestorRepositoryBundle(connection),
      leagues,
      pollIntervalMs,
      maxCycles,
      autorun,
      skipResults,
      apiKey: env.SGO_API_KEY,
    };
  } catch {
    return {
      persistenceMode: 'in-memory' as const,
      repositories: createInMemoryIngestorRepositoryBundle(),
      leagues,
      pollIntervalMs,
      maxCycles,
      autorun,
      skipResults,
      apiKey: env.SGO_API_KEY,
    };
  }
}

export function createIngestorRuntimeSummary() {
  const runtime = createIngestorRuntimeDependencies();
  return {
    service: 'ingestor',
    status: 'ready',
    persistenceMode: runtime.persistenceMode,
    provider: 'sgo',
    leagues: runtime.leagues,
    pollIntervalMs: runtime.pollIntervalMs,
    maxCyclesPerRun: runtime.maxCycles ?? 0,
    autorun: runtime.autorun,
    skipResults: runtime.skipResults,
    apiKeyConfigured: Boolean(runtime.apiKey),
    nextStep: runtime.autorun
      ? 'ingestor cycles will execute with the configured SGO provider settings'
      : 'set UNIT_TALK_INGESTOR_AUTORUN=true to execute ingestor cycles',
  };
}

const runtime = createIngestorRuntimeDependencies();

if (runtime.autorun) {
  runIngestorCycles({
    repositories: runtime.repositories,
    leagues: runtime.leagues,
    ...(runtime.apiKey ? { apiKey: runtime.apiKey } : {}),
    ...(runtime.maxCycles !== undefined ? { maxCycles: runtime.maxCycles } : {}),
    skipResults: runtime.skipResults,
    pollIntervalMs: runtime.pollIntervalMs,
    logger: console,
  })
    .then((cycles) => {
      console.log(
        JSON.stringify(
          {
            ...createIngestorRuntimeSummary(),
            executedCycles: cycles.length,
            results: cycles,
          },
          null,
          2,
        ),
      );
    })
    .catch((error: unknown) => {
      console.error(
        JSON.stringify(
          {
            ...createIngestorRuntimeSummary(),
            status: 'error',
            error: error instanceof Error ? error.message : 'unknown ingestor error',
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    });
} else {
  console.log(JSON.stringify(createIngestorRuntimeSummary(), null, 2));
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}
