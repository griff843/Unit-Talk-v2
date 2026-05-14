import {
  assertProductionRuntimeConfig,
  createRuntimeConfigFailureLogFields,
  loadEnvironment,
  type AppEnv,
  type RuntimeMode,
  RuntimeConfigError,
} from '@unit-talk/config';
import {
  createDatabaseIngestorRepositoryBundle,
  createInMemoryIngestorRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import {
  buildRuntimeTruthReport,
  createConsoleLogWriter,
  createDualLogWriter,
  createErrorTracker,
  createLogger,
  createLokiLogWriter,
  type RuntimeTruthReport,
} from '@unit-talk/observability';
import { parseConfiguredLeagues, runIngestorCycles } from './ingestor-runner.js';
import { parseSchedulerConfig, type SchedulerEnv } from './scheduler.js';
import {
  collectConfiguredSgoApiKeyCandidates,
  resolveActiveSgoApiKey,
} from './sgo-key-manager.js';
import { parseProviderOfferStagingMode } from './provider-offer-staging.js';
import {
  resolveProviderIngestionDbWritePolicy,
  resolveProviderPayloadArchivePolicy,
} from './provider-ingestion-policy.js';

const lokiUrl = process.env.LOKI_URL?.trim();
const ingestorWriter = lokiUrl
  ? createDualLogWriter(createConsoleLogWriter(), createLokiLogWriter({ url: lokiUrl }))
  : undefined;
const logger = createLogger({
  service: 'ingestor',
  ...(ingestorWriter ? { writer: ingestorWriter } : {}),
});
const errorTracker = createErrorTracker({ service: 'ingestor', logger });

function createIngestorRuntimeDependencies(options: { environment?: AppEnv } = {}) {
  const env = options.environment ?? loadEnvironment();
  const leagues = parseConfiguredLeagues(env.UNIT_TALK_INGESTOR_LEAGUES);
  const pollIntervalMs = parsePositiveInt(env.UNIT_TALK_INGESTOR_POLL_MS, 300_000);
  const configuredMaxCycles = parsePositiveInt(env.UNIT_TALK_INGESTOR_MAX_CYCLES, 1);
  const maxCycles = configuredMaxCycles === 0 ? undefined : configuredMaxCycles;
  const autorun = env.UNIT_TALK_INGESTOR_AUTORUN === 'true';
  const skipResults = env.UNIT_TALK_INGESTOR_SKIP_RESULTS === 'true';
  const resultsLookbackHours = parsePositiveInt(
    env.UNIT_TALK_INGESTOR_RESULTS_LOOKBACK_HOURS,
    48,
  );
  const resultsMaxFetchMs = parsePositiveInt(
    env.UNIT_TALK_INGESTOR_RESULTS_MAX_FETCH_MS,
    300_000,
  );
  const apiUrl = env.UNIT_TALK_API_URL;
  const schedulerConfig = parseSchedulerConfig(env as SchedulerEnv);
  const sgoApiKeys = collectConfiguredSgoApiKeyCandidates(env);

  const startupOptions = {
    service: 'ingestor',
    runtimeModeKey: 'UNIT_TALK_INGESTOR_RUNTIME_MODE',
    requiredKeys: [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'UNIT_TALK_API_URL',
      'UNIT_TALK_INGESTOR_API_KEY',
    ],
    requiredKeyGroups: [
      { name: 'provider auth', keys: ['SGO_API_KEY', 'SGO_API_KEY_FALLBACK', 'ODDS_API_KEY'] },
    ],
    persistenceMode: hasDatabaseEnvironment(env) ? 'database' : 'in-memory',
    dryRun: false,
    autorun,
    maxCyclesPerRun: maxCycles ?? 0,
    maxCyclesKey: 'UNIT_TALK_INGESTOR_MAX_CYCLES',
    prohibitSingleCycleAutorunInProduction: true,
  } as const;
  let startupConfig;
  try {
    startupConfig = assertProductionRuntimeConfig(env, startupOptions);
  } catch (error) {
    if (error instanceof RuntimeConfigError) {
      console.error(
        '[ingestor] Startup config invalid:',
        JSON.stringify(
          createRuntimeConfigFailureLogFields(env, startupOptions, error),
        ),
      );
    }
    throw error;
  }
  const runtimeMode = startupConfig.runtimeMode;
  const providerOfferStagingMode = parseProviderOfferStagingMode(
    env.UNIT_TALK_PROVIDER_OFFER_STAGING_MODE,
  );
  const providerDbWritePolicy = resolveProviderIngestionDbWritePolicy(env);
  const providerPayloadArchivePolicy = resolveProviderPayloadArchivePolicy(env);

  try {
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    return withIngestorRuntimeTruth({
      persistenceMode: 'database' as const,
      runtimeMode,
      appVersion: startupConfig.appVersion,
      repositories: createDatabaseIngestorRepositoryBundle(connection),
      retentionConnection: connection,
      leagues,
      pollIntervalMs,
      maxCycles,
      autorun,
      skipResults,
      resultsLookbackHours,
      resultsMaxFetchMs,
      schedulerConfig,
      providerOfferStagingMode,
      providerDbWritePolicy,
      providerPayloadArchivePolicy,
      sgoApiKeys,
      oddsApiKey: env.ODDS_API_KEY,
      ingestorApiKey: env.UNIT_TALK_INGESTOR_API_KEY,
      apiUrl,
    });
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

    return withIngestorRuntimeTruth({
      persistenceMode: 'in-memory' as const,
      runtimeMode,
      appVersion: startupConfig.appVersion,
      repositories: createInMemoryIngestorRepositoryBundle(),
      leagues,
      pollIntervalMs,
      maxCycles,
      autorun,
      skipResults,
      resultsLookbackHours,
      resultsMaxFetchMs,
      schedulerConfig,
      providerOfferStagingMode,
      providerDbWritePolicy,
      providerPayloadArchivePolicy,
      sgoApiKeys,
      oddsApiKey: env.ODDS_API_KEY,
      ingestorApiKey: env.UNIT_TALK_INGESTOR_API_KEY,
      apiUrl,
    });
  }
}

export function createIngestorRuntimeSummary() {
  const runtime = createIngestorRuntimeDependencies();
  return {
    service: 'ingestor',
    status: 'ready',
    persistenceMode: runtime.persistenceMode,
    runtimeMode: runtime.runtimeMode,
    dryRun: false,
    workerTargets: [],
    appVersion: runtime.appVersion,
    providers: {
      sgo: runtime.sgoApiKeys.length > 0 ? 'configured' : 'missing',
      oddsApi: runtime.oddsApiKey ? 'configured' : 'missing',
    },
    leagues: runtime.leagues,
    pollIntervalMs: runtime.pollIntervalMs,
    maxCyclesPerRun: runtime.maxCycles ?? 0,
    autorun: runtime.autorun,
    skipResults: runtime.skipResults,
    resultsLookbackHours: runtime.resultsLookbackHours,
    providerOfferStagingMode: runtime.providerOfferStagingMode,
    providerDbWritePolicy: runtime.providerDbWritePolicy,
    providerPayloadArchivePolicy: runtime.providerPayloadArchivePolicy,
    runtimeTruth: runtime.runtimeTruth,
    scheduler: {
      enabled: runtime.schedulerConfig.enabled,
      peakPollMs: runtime.schedulerConfig.peakPollMs,
      offPeakPollMs: runtime.schedulerConfig.offPeakPollMs,
      peakWindowEt: `${runtime.schedulerConfig.peakStartHourEt}:00-${runtime.schedulerConfig.peakEndHourEt}:00`,
    },
    sgoApiKeys: runtime.sgoApiKeys.map((candidate) => ({
      source: candidate.source,
      tag: candidate.tag,
    })),
    apiKeyConfigured: runtime.sgoApiKeys.length > 0,
    apiUrlConfigured: Boolean(runtime.apiUrl),
    nextStep: runtime.autorun
      ? 'ingestor cycles will execute with the configured SGO provider settings'
      : 'set UNIT_TALK_INGESTOR_AUTORUN=true to execute ingestor cycles',
  };
}

function withIngestorRuntimeTruth<T extends {
  persistenceMode: 'database' | 'in-memory';
  runtimeMode: RuntimeMode;
  appVersion: string;
  leagues: string[];
  pollIntervalMs: number;
  maxCycles?: number | undefined;
  autorun: boolean;
  skipResults: boolean;
  providerOfferStagingMode: string;
  providerDbWritePolicy: unknown;
  providerPayloadArchivePolicy: unknown;
  schedulerConfig: { enabled: boolean };
  sgoApiKeys: Array<unknown>;
  oddsApiKey?: string | undefined;
  ingestorApiKey?: string | undefined;
  apiUrl?: string | undefined;
}>(runtime: T): T & { runtimeTruth: RuntimeTruthReport } {
  const doingRealWork =
    runtime.persistenceMode === 'database' &&
    runtime.autorun &&
    (runtime.sgoApiKeys.length > 0 || Boolean(runtime.oddsApiKey));

  return {
    ...runtime,
    runtimeTruth: buildRuntimeTruthReport({
      service: 'ingestor',
      observedAt: new Date().toISOString(),
      runtimeMode: runtime.runtimeMode,
      persistenceMode: runtime.persistenceMode,
      appVersion: runtime.appVersion,
      authEnabled: Boolean(runtime.ingestorApiKey),
      workerTargets: [],
      dryRun: false,
      doingRealWork,
      realWorkReason: buildIngestorRealWorkReason(runtime, doingRealWork),
      lastWorkAt: null,
      details: {
        leagues: runtime.leagues,
        pollIntervalMs: runtime.pollIntervalMs,
        maxCyclesPerRun: runtime.maxCycles ?? 0,
        autorun: runtime.autorun,
        skipResults: runtime.skipResults,
        providerOfferStagingMode: runtime.providerOfferStagingMode,
        providerDbWritePolicy: runtime.providerDbWritePolicy,
        providerPayloadArchivePolicy: runtime.providerPayloadArchivePolicy,
        schedulerEnabled: runtime.schedulerConfig.enabled,
        providers: {
          sgo: runtime.sgoApiKeys.length > 0 ? 'configured' : 'missing',
          oddsApi: runtime.oddsApiKey ? 'configured' : 'missing',
        },
        apiUrlConfigured: Boolean(runtime.apiUrl),
      },
    }),
  };
}

function buildIngestorRealWorkReason(
  runtime: {
    persistenceMode: 'database' | 'in-memory';
    autorun: boolean;
    sgoApiKeys: Array<unknown>;
    oddsApiKey?: string | undefined;
  },
  doingRealWork: boolean,
): string {
  if (doingRealWork) {
    return 'autorun ingestor is using database persistence with provider credentials configured';
  }
  if (runtime.persistenceMode !== 'database') {
    return 'in-memory persistence cannot write durable provider data';
  }
  if (!runtime.autorun) {
    return 'autorun is disabled';
  }
  if (runtime.sgoApiKeys.length === 0 && !runtime.oddsApiKey) {
    return 'provider credentials are missing';
  }
  return 'ingestor runtime is not configured for live provider work';
}

const runtime = createIngestorRuntimeDependencies();

const opsAlertWebhookUrl = process.env['UNIT_TALK_OPS_ALERT_WEBHOOK_URL']?.trim() || undefined;

async function postOpsAlert(webhookUrl: string, message: string): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
  } catch {
    // intentionally swallowed — best-effort ops notification
  }
}

if (runtime.autorun) {
  resolveActiveSgoApiKey(runtime.sgoApiKeys)
    .then(async (sgoSelection) => {
      const reaped = await runtime.repositories.runs.reapStaleRuns({
        runType: 'ingestor.cycle',
        staleAfterMs: 15 * 60 * 1000,
      });
      if (reaped > 0) {
        logger.warn('reaped stale ingestor runs', { count: reaped });
      }
      return sgoSelection;
    })
    .then(async (sgoSelection) => ({
      sgoSelection,
      cycles: await runIngestorCycles({
        repositories: runtime.repositories,
        leagues: runtime.leagues,
        ...(sgoSelection.active ? { apiKey: sgoSelection.active.apiKey } : {}),
        ...(runtime.oddsApiKey ? { oddsApiKey: runtime.oddsApiKey } : {}),
        ...(runtime.apiUrl ? { apiUrl: runtime.apiUrl } : {}),
        ...(runtime.ingestorApiKey ? { ingestorApiKey: runtime.ingestorApiKey } : {}),
        maxCycles: runtime.maxCycles ?? Number.POSITIVE_INFINITY,
        skipResults: runtime.skipResults,
        resultsLookbackHours: runtime.resultsLookbackHours,
        resultsMaxFetchMs: runtime.resultsMaxFetchMs,
        pollIntervalMs: runtime.pollIntervalMs,
        schedulerConfig: runtime.schedulerConfig,
        providerDbWritePolicy: runtime.providerDbWritePolicy,
        providerPayloadArchivePolicy: runtime.providerPayloadArchivePolicy,
        logger: console,
        ...('retentionConnection' in runtime && runtime.retentionConnection
          ? { retentionConnection: runtime.retentionConnection }
          : {}),
        ...(opsAlertWebhookUrl
          ? { onStalenessAlert: (msg: string) => postOpsAlert(opsAlertWebhookUrl, msg) }
          : {}),
      }),
    }))
    .then(({ cycles, sgoSelection }) => {
      console.log(
        JSON.stringify(
          {
            ...createIngestorRuntimeSummary(),
            activeSgoKey: sgoSelection.active
              ? {
                  source: sgoSelection.active.source,
                  tag: sgoSelection.active.tag,
                }
              : null,
            sgoKeyProbe: sgoSelection.probes,
            executedCycles: cycles.length,
            results: cycles,
          },
          null,
          2,
        ),
      );
    })
    .catch((error: unknown) => {
      void errorTracker.captureException({
        operation: 'ingestor.autorun',
        error,
        severity: 'critical',
        fields: {
          leagues: runtime.leagues,
          skipResults: runtime.skipResults,
          providers: {
            sgo: runtime.sgoApiKeys.length > 0 ? 'configured' : 'missing',
            oddsApi: runtime.oddsApiKey ? 'configured' : 'missing',
          },
        },
      });
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

type _IngestorRuntimeMode = RuntimeMode;

function hasDatabaseEnvironment(environment: AppEnv) {
  return Boolean(
    environment.SUPABASE_URL &&
      environment.SUPABASE_ANON_KEY &&
      environment.SUPABASE_SERVICE_ROLE_KEY,
  );
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
