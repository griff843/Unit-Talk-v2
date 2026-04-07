export interface IngestorSupervisorState {
  supervisorPid: number | null;
  childPid: number | null;
  status: 'starting' | 'running' | 'restarting' | 'stopping' | 'stopped';
  startedAt: string;
  childStartedAt: string | null;
  restartCount: number;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  lastExitAt: string | null;
  lastError: string | null;
}

export interface IngestorHealthInput {
  autorun: boolean;
  pollIntervalMs: number;
  supervisorRunning: boolean;
  childRunning: boolean;
  restartCount: number;
  latestRunStatus: string | null;
  latestRunStartedAt: string | null;
  latestOfferCreatedAt: string | null;
}

export interface IngestorHealthReport {
  status: 'healthy' | 'degraded' | 'down';
  summary: string;
  facts: string[];
}

const MIN_RUN_FRESHNESS_MS = 15 * 60_000;
const MIN_OFFER_FRESHNESS_MS = 20 * 60_000;
const MAX_RESTART_DELAY_MS = 30_000;

export function createInitialSupervisorState(now = new Date(), supervisorPid: number | null = null): IngestorSupervisorState {
  return {
    supervisorPid,
    childPid: null,
    status: 'starting',
    startedAt: now.toISOString(),
    childStartedAt: null,
    restartCount: 0,
    lastExitCode: null,
    lastExitSignal: null,
    lastExitAt: null,
    lastError: null,
  };
}

export function calculateRestartDelayMs(restartCount: number) {
  const boundedCount = Math.max(0, restartCount);
  return Math.min(1000 * (2 ** boundedCount), MAX_RESTART_DELAY_MS);
}

export function evaluateIngestorHealth(
  input: IngestorHealthInput,
  now = new Date(),
): IngestorHealthReport {
  const facts: string[] = [];

  if (!input.autorun) {
    return {
      status: 'down',
      summary: 'Ingestor autorun is disabled.',
      facts: ['Set UNIT_TALK_INGESTOR_AUTORUN=true before starting supervised runtime.'],
    };
  }

  if (!input.supervisorRunning) {
    return {
      status: 'down',
      summary: 'Supervisor is not running.',
      facts: ['Use the repo supervisor start command to keep ingestor alive.'],
    };
  }

  if (!input.childRunning) {
    facts.push(`restartCount=${input.restartCount}`);
    return {
      status: 'degraded',
      summary: 'Supervisor is running, but the ingestor child is currently down.',
      facts,
    };
  }

  const runFreshnessMs = Math.max(input.pollIntervalMs * 2, MIN_RUN_FRESHNESS_MS);
  const offerFreshnessMs = Math.max(input.pollIntervalMs * 2, MIN_OFFER_FRESHNESS_MS);

  if (!input.latestRunStartedAt) {
    facts.push('No ingestor.cycle rows recorded yet.');
    return {
      status: 'degraded',
      summary: 'Supervisor is up, but the ingestor has not recorded a cycle yet.',
      facts,
    };
  }

  const runAgeMs = now.getTime() - new Date(input.latestRunStartedAt).getTime();
  facts.push(`lastCycleAgeMs=${runAgeMs}`);

  if (input.latestRunStatus === 'failed') {
    facts.push('Latest ingestor.cycle row is failed.');
    return {
      status: runAgeMs > runFreshnessMs * 2 ? 'down' : 'degraded',
      summary: 'Ingestor is running, but the latest cycle failed.',
      facts,
    };
  }

  if (runAgeMs > runFreshnessMs * 2) {
    facts.push(`runFreshnessThresholdMs=${runFreshnessMs}`);
    return {
      status: 'down',
      summary: 'Ingestor cycle heartbeat is stale.',
      facts,
    };
  }

  if (runAgeMs > runFreshnessMs) {
    facts.push(`runFreshnessThresholdMs=${runFreshnessMs}`);
    return {
      status: 'degraded',
      summary: 'Ingestor cycle heartbeat is older than expected.',
      facts,
    };
  }

  if (!input.latestOfferCreatedAt) {
    return {
      status: 'degraded',
      summary: 'Ingestor cycles are running, but no provider offers have been written yet.',
      facts,
    };
  }

  const offerAgeMs = now.getTime() - new Date(input.latestOfferCreatedAt).getTime();
  facts.push(`latestOfferAgeMs=${offerAgeMs}`);

  if (offerAgeMs > offerFreshnessMs * 2) {
    facts.push(`offerFreshnessThresholdMs=${offerFreshnessMs}`);
    return {
      status: 'down',
      summary: 'Provider offer freshness is stale even though the ingestor is running.',
      facts,
    };
  }

  if (offerAgeMs > offerFreshnessMs) {
    facts.push(`offerFreshnessThresholdMs=${offerFreshnessMs}`);
    return {
      status: 'degraded',
      summary: 'Provider offers are older than expected for the current poll interval.',
      facts,
    };
  }

  facts.push(`restartCount=${input.restartCount}`);

  return {
    status: 'healthy',
    summary: 'Supervisor, ingestor child, and ingest freshness all look healthy.',
    facts,
  };
}
