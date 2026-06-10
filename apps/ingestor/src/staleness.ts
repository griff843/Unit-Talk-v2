export type IngestorHealthStatus = 'HEALTHY' | 'DEGRADED' | 'FAILED';

export type IngestorHealthCode =
  | 'HEALTHY'
  | 'HUNG_SINGLETON'
  | 'DB_TIMEOUT'
  | 'API_KEY'
  | 'NO_SLATE'
  | 'STALE_OFFERS'
  | 'STALE_CYCLE'
  | 'FAILED_CYCLE'
  | 'RUNTIME_DOWN'
  | 'NO_CYCLE';

export interface ProviderOfferStalenessInput {
  latestOfferUpdatedAt: string | null;
  staleThresholdMinutes: number;
  now?: Date;
}

export interface ProviderOfferStalenessResult {
  status: 'HEALTHY' | 'STALE';
  dataStale: boolean;
  ageMinutes: number | null;
  staleThresholdMinutes: number;
  latestOfferUpdatedAt: string | null;
  staleSince?: string;
}

export interface IngestorOutageHealthInput extends ProviderOfferStalenessInput {
  runtimeRunning: boolean;
  latestRunStartedAt: string | null;
  /** Status of the most recent ingestor.cycle row ('running', 'failed', 'succeeded'). */
  latestRunStatus?: string | null;
  /** Error message from the most recent failed ingestor.cycle row's details. */
  lastFailureReason?: string | null;
  /** True when a stale 'running' system_runs row was reaped at startup (hung singleton detected). */
  hasHungSingleton?: boolean;
  /** True when no SGO_API_KEY or ODDS_API_KEY is configured. */
  hasNoApiKey?: boolean;
  /** True when the most recent cycle returned 0 events from the provider. */
  hasNoSlate?: boolean;
}

export interface IngestorOutageHealthResult extends Omit<ProviderOfferStalenessResult, 'status'> {
  status: IngestorHealthStatus;
  code: IngestorHealthCode;
  outage: boolean;
  latestRunStartedAt: string | null;
  summary: string;
}

export function evaluateProviderOfferStaleness(
  input: ProviderOfferStalenessInput,
): ProviderOfferStalenessResult {
  const now = input.now ?? new Date();
  const staleThresholdMinutes = input.staleThresholdMinutes;

  if (!input.latestOfferUpdatedAt) {
    return {
      status: 'STALE',
      dataStale: true,
      ageMinutes: null,
      staleThresholdMinutes,
      latestOfferUpdatedAt: null,
      staleSince: now.toISOString(),
    };
  }

  const updatedAt = new Date(input.latestOfferUpdatedAt);
  const ageMinutes = Math.max(0, Math.round((now.getTime() - updatedAt.getTime()) / 60_000));
  const dataStale = ageMinutes > staleThresholdMinutes;

  return {
    status: dataStale ? 'STALE' : 'HEALTHY',
    dataStale,
    ageMinutes,
    staleThresholdMinutes,
    latestOfferUpdatedAt: input.latestOfferUpdatedAt,
    ...(dataStale ? { staleSince: input.latestOfferUpdatedAt } : {}),
  };
}

export function evaluateIngestorOutageHealth(
  input: IngestorOutageHealthInput,
): IngestorOutageHealthResult {
  const staleness = evaluateProviderOfferStaleness(input);

  if (input.hasNoApiKey) {
    return {
      ...staleness,
      status: 'FAILED',
      code: 'API_KEY',
      outage: true,
      latestRunStartedAt: input.latestRunStartedAt,
      summary: 'No provider API key configured (SGO_API_KEY / ODDS_API_KEY missing).',
    };
  }

  if (input.hasHungSingleton) {
    return {
      ...staleness,
      status: 'DEGRADED',
      code: 'HUNG_SINGLETON',
      outage: false,
      latestRunStartedAt: input.latestRunStartedAt,
      summary: 'A stale running ingestor cycle was reaped at startup (hung singleton recovered).',
    };
  }

  if (!input.runtimeRunning || !input.latestRunStartedAt) {
    return {
      ...staleness,
      status: 'FAILED',
      code: 'RUNTIME_DOWN',
      outage: true,
      latestRunStartedAt: input.latestRunStartedAt,
      summary: !input.runtimeRunning
        ? 'Ingestor runtime is not running.'
        : 'Ingestor has not recorded a run.',
    };
  }

  if (input.latestRunStatus === 'running') {
    const runAgeMs = input.latestRunStartedAt
      ? (input.now ?? new Date()).getTime() - new Date(input.latestRunStartedAt).getTime()
      : 0;
    if (runAgeMs > 15 * 60_000) {
      return {
        ...staleness,
        status: 'DEGRADED',
        code: 'HUNG_SINGLETON',
        outage: false,
        latestRunStartedAt: input.latestRunStartedAt,
        summary: `Ingestor cycle has been running for ${Math.round(runAgeMs / 60_000)}m — potential hung singleton.`,
      };
    }
  }

  if (input.latestRunStatus === 'failed' && input.lastFailureReason) {
    const isTimeout =
      input.lastFailureReason.includes('statement timeout') ||
      input.lastFailureReason.includes('canceling statement');
    if (isTimeout) {
      return {
        ...staleness,
        status: 'DEGRADED',
        code: 'DB_TIMEOUT',
        outage: staleness.dataStale,
        latestRunStartedAt: input.latestRunStartedAt,
        summary: 'Latest ingestor cycle failed due to database statement timeout.',
      };
    }
  }

  if (input.hasNoSlate) {
    return {
      ...staleness,
      status: 'DEGRADED',
      code: 'NO_SLATE',
      outage: false,
      latestRunStartedAt: input.latestRunStartedAt,
      summary: 'Latest ingestor cycle returned 0 events — no slate available from provider.',
    };
  }

  if (input.latestRunStatus === 'failed') {
    return {
      ...staleness,
      status: staleness.dataStale ? 'FAILED' : 'DEGRADED',
      code: 'FAILED_CYCLE',
      outage: staleness.dataStale,
      latestRunStartedAt: input.latestRunStartedAt,
      summary: 'Latest ingestor cycle failed.',
    };
  }

  if (staleness.dataStale) {
    return {
      ...staleness,
      status: 'DEGRADED',
      code: 'STALE_OFFERS',
      outage: false,
      latestRunStartedAt: input.latestRunStartedAt,
      summary: 'Provider offer data is stale.',
    };
  }

  return {
    ...staleness,
    status: 'HEALTHY',
    code: 'HEALTHY',
    outage: false,
    latestRunStartedAt: input.latestRunStartedAt,
    summary: 'Ingestor runtime and provider offer data are healthy.',
  };
}
