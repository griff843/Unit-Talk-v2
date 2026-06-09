import type { IngestorHealthCode } from './staleness.js';

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
  /** Error message from the most recent failed cycle's details (for DB_TIMEOUT detection). */
  lastFailureReason?: string | null;
  /** True when a stale 'running' system_runs row was reaped at this startup. */
  hasHungSingleton?: boolean;
  /** True when no SGO_API_KEY or ODDS_API_KEY is configured. */
  hasNoApiKey?: boolean;
  /** True when the most recent cycle returned 0 events from the provider. */
  hasNoSlate?: boolean;
}

export interface IngestorHealthReport {
  status: 'healthy' | 'degraded' | 'down';
  code: IngestorHealthCode;
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
      code: 'API_KEY',
      summary: 'Ingestor autorun is disabled.',
      facts: ['Set UNIT_TALK_INGESTOR_AUTORUN=true before starting supervised runtime.'],
    };
  }

  if (input.hasNoApiKey) {
    return {
      status: 'down',
      code: 'API_KEY',
      summary: 'No provider API key configured (SGO_API_KEY / ODDS_API_KEY missing).',
      facts: ['Set SGO_API_KEY or ODDS_API_KEY before starting.'],
    };
  }

  if (!input.supervisorRunning) {
    return {
      status: 'down',
      code: 'RUNTIME_DOWN',
      summary: 'Supervisor is not running.',
      facts: ['Use the repo supervisor start command to keep ingestor alive.'],
    };
  }

  if (input.hasHungSingleton) {
    facts.push('A stale running ingestor cycle was reaped at startup.');
    return {
      status: 'degraded',
      code: 'HUNG_SINGLETON',
      summary: 'Hung singleton reaped at startup — ingestor may have stalled previously.',
      facts,
    };
  }

  if (!input.childRunning) {
    facts.push(`restartCount=${input.restartCount}`);
    return {
      status: 'degraded',
      code: 'RUNTIME_DOWN',
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
      code: 'NO_CYCLE',
      summary: 'Supervisor is up, but the ingestor has not recorded a cycle yet.',
      facts,
    };
  }

  const runAgeMs = now.getTime() - new Date(input.latestRunStartedAt).getTime();
  facts.push(`lastCycleAgeMs=${runAgeMs}`);

  if (input.latestRunStatus === 'running' && runAgeMs > MIN_RUN_FRESHNESS_MS) {
    facts.push(`runningForMs=${runAgeMs}`);
    return {
      status: 'degraded',
      code: 'HUNG_SINGLETON',
      summary: `Ingestor cycle has been running for ${Math.round(runAgeMs / 60_000)}m — potential hung singleton.`,
      facts,
    };
  }

  if (input.latestRunStatus === 'failed') {
    facts.push('Latest ingestor.cycle row is failed.');
    if (input.lastFailureReason) {
      const isTimeout =
        input.lastFailureReason.includes('statement timeout') ||
        input.lastFailureReason.includes('canceling statement');
      if (isTimeout) {
        facts.push(`failureReason=${input.lastFailureReason}`);
        return {
          status: runAgeMs > runFreshnessMs * 2 ? 'down' : 'degraded',
          code: 'DB_TIMEOUT',
          summary: 'Latest ingestor cycle failed due to database statement timeout.',
          facts,
        };
      }
    }
    if (input.hasNoSlate) {
      return {
        status: 'degraded',
        code: 'NO_SLATE',
        summary: 'Latest ingestor cycle returned 0 events — no slate available from provider.',
        facts,
      };
    }
    return {
      status: runAgeMs > runFreshnessMs * 2 ? 'down' : 'degraded',
      code: 'FAILED_CYCLE',
      summary: 'Ingestor is running, but the latest cycle failed.',
      facts,
    };
  }

  if (input.hasNoSlate) {
    return {
      status: 'degraded',
      code: 'NO_SLATE',
      summary: 'Latest ingestor cycle returned 0 events — no slate available from provider.',
      facts,
    };
  }

  if (runAgeMs > runFreshnessMs * 2) {
    facts.push(`runFreshnessThresholdMs=${runFreshnessMs}`);
    return {
      status: 'down',
      code: 'STALE_CYCLE',
      summary: 'Ingestor cycle heartbeat is stale.',
      facts,
    };
  }

  if (runAgeMs > runFreshnessMs) {
    facts.push(`runFreshnessThresholdMs=${runFreshnessMs}`);
    return {
      status: 'degraded',
      code: 'STALE_CYCLE',
      summary: 'Ingestor cycle heartbeat is older than expected.',
      facts,
    };
  }

  if (!input.latestOfferCreatedAt) {
    return {
      status: 'degraded',
      code: 'STALE_OFFERS',
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
      code: 'STALE_OFFERS',
      summary: 'Provider offer freshness is stale even though the ingestor is running.',
      facts,
    };
  }

  if (offerAgeMs > offerFreshnessMs) {
    facts.push(`offerFreshnessThresholdMs=${offerFreshnessMs}`);
    return {
      status: 'degraded',
      code: 'STALE_OFFERS',
      summary: 'Provider offers are older than expected for the current poll interval.',
      facts,
    };
  }

  facts.push(`restartCount=${input.restartCount}`);

  return {
    status: 'healthy',
    code: 'HEALTHY',
    summary: 'Supervisor, ingestor child, and ingest freshness all look healthy.',
    facts,
  };
}
