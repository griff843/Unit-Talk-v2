import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseIngestorRepositoryBundle,
  createInMemoryIngestorRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import {
  createConsoleLogWriter,
  createDualLogWriter,
  createLogger,
  createLokiLogWriter,
} from '@unit-talk/observability';
import { parseConfiguredLeagues, runIngestorCycles } from './ingestor-runner.js';

const lokiUrl = process.env.LOKI_URL?.trim();
const ingestorWriter = lokiUrl
  ? createDualLogWriter(createConsoleLogWriter(), createLokiLogWriter({ url: lokiUrl }))
  : undefined;
const logger = createLogger({ service: 'ingestor', ...(ingestorWriter ? { writer: ingestorWriter } : {}) });

function createIngestorRuntimeDependencies() {
  const env = loadEnvironment();
  const leagues = parseConfiguredLeagues(env.UNIT_TALK_INGESTOR_LEAGUES);
  const pollIntervalMs = parsePositiveInt(env.UNIT_TALK_INGESTOR_POLL_MS, 300_000);
  const configuredMaxCycles = parsePositiveInt(env.UNIT_TALK_INGESTOR_MAX_CYCLES, 1);
  const maxCycles = configuredMaxCycles === 0 ? undefined : configuredMaxCycles;
  const autorun = env.UNIT_TALK_INGESTOR_AUTORUN === 'true';
  const skipResults = env.UNIT_TALK_INGESTOR_SKIP_RESULTS === 'true';
  const apiUrl = env.UNIT_TALK_API_URL;

  const runtimeMode = readIngestorRuntimeMode(env);

  try {
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    return {
      persistenceMode: 'database' as const,
      runtimeMode,
      repositories: createDatabaseIngestorRepositoryBundle(connection),
      leagues,
      pollIntervalMs,
      maxCycles,
      autorun,
      skipResults,
      apiKey: env.SGO_API_KEY,
      oddsApiKey: env.ODDS_API_KEY,
      apiUrl,
    };
  } catch (error) {
    if (runtimeMode === 'fail_closed') {
      throw new Error(
        'Ingestor runtime mode is fail_closed and database configuration could not be loaded. ' +
        'Set UNIT_TALK_APP_ENV=local or UNIT_TALK_INGESTOR_RUNTIME_MODE=fail_open to allow in-memory fallback.',
        { cause: error },
      );
    }

    logger.warn('falling back to in-memory ingestor runtime', {
      persistenceMode: 'in-memory',
      reason: error instanceof Error ? error.message : String(error),
    });

    return {
      persistenceMode: 'in-memory' as const,
      runtimeMode,
      repositories: createInMemoryIngestorRepositoryBundle(),
      leagues,
      pollIntervalMs,
      maxCycles,
      autorun,
      skipResults,
      apiKey: env.SGO_API_KEY,
      oddsApiKey: env.ODDS_API_KEY,
      apiUrl,
    };
  }
}

export function createIngestorRuntimeSummary() {
  const runtime = createIngestorRuntimeDependencies();
  return {
    service: 'ingestor',
    status: 'ready',
    persistenceMode: runtime.persistenceMode,
    runtimeMode: runtime.runtimeMode,
    providers: {
      sgo: runtime.apiKey ? 'configured' : 'missing',
      oddsApi: runtime.oddsApiKey ? 'configured' : 'missing',
    },
    leagues: runtime.leagues,
    pollIntervalMs: runtime.pollIntervalMs,
    maxCyclesPerRun: runtime.maxCycles ?? 0,
    autorun: runtime.autorun,
    skipResults: runtime.skipResults,
    apiKeyConfigured: Boolean(runtime.apiKey),
    apiUrlConfigured: Boolean(runtime.apiUrl),
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
    ...(runtime.oddsApiKey ? { oddsApiKey: runtime.oddsApiKey } : {}),
    ...(runtime.apiUrl ? { apiUrl: runtime.apiUrl } : {}),
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

type IngestorRuntimeMode = 'fail_open' | 'fail_closed';

function readIngestorRuntimeMode(env: {
  UNIT_TALK_INGESTOR_RUNTIME_MODE?: string | undefined;
  UNIT_TALK_APP_ENV?: string | undefined;
}): IngestorRuntimeMode {
  const configured = env.UNIT_TALK_INGESTOR_RUNTIME_MODE?.trim().toLowerCase();
  if (configured === 'fail_closed') return 'fail_closed';
  if (configured === 'fail_open') return 'fail_open';
  return env.UNIT_TALK_APP_ENV === 'local' ? 'fail_open' : 'fail_closed';
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
