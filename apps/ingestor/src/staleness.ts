export type IngestorHealthStatus = 'HEALTHY' | 'DEGRADED' | 'FAILED';

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
}

export interface IngestorOutageHealthResult extends Omit<ProviderOfferStalenessResult, 'status'> {
  status: IngestorHealthStatus;
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

  if (!input.runtimeRunning || !input.latestRunStartedAt) {
    return {
      ...staleness,
      status: 'FAILED',
      outage: true,
      latestRunStartedAt: input.latestRunStartedAt,
      summary: !input.runtimeRunning
        ? 'Ingestor runtime is not running.'
        : 'Ingestor has not recorded a run.',
    };
  }

  if (staleness.dataStale) {
    return {
      ...staleness,
      status: 'DEGRADED',
      outage: false,
      latestRunStartedAt: input.latestRunStartedAt,
      summary: 'Provider offer data is stale.',
    };
  }

  return {
    ...staleness,
    status: 'HEALTHY',
    outage: false,
    latestRunStartedAt: input.latestRunStartedAt,
    summary: 'Ingestor runtime and provider offer data are healthy.',
  };
}
