import type { RepositoryBundle } from '@unit-talk/db';
import {
  listLineMovementAlerts,
  type LineMovementAlertSignal,
  type ListLineMovementAlertsOptions,
} from './alert-agent-service.js';

const ALERT_AGENT_INTERVAL_MS = 60_000;
const emittedSignalIds = new Set<string>();

export function startAlertAgent(
  repositories: Pick<
    RepositoryBundle,
    'eventParticipants' | 'events' | 'participants' | 'picks' | 'providerOffers'
  >,
  logger: Pick<Console, 'error' | 'info'> = console,
  options: {
    listOptions?: ListLineMovementAlertsOptions;
    onSignals?: (signals: LineMovementAlertSignal[]) => void | Promise<void>;
  } = {},
) {
  const interval = setInterval(() => {
    checkAndEmitLineMovementAlerts(repositories, logger, options).catch((err: unknown) => {
      logger.error(
        JSON.stringify({
          service: 'alert-agent',
          event: 'tick.unhandled_error',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  }, ALERT_AGENT_INTERVAL_MS);

  return () => {
    clearInterval(interval);
  };
}

export function resetAlertAgentStateForTests() {
  emittedSignalIds.clear();
}

export async function checkAndEmitLineMovementAlertsForTests(
  repositories: Pick<
    RepositoryBundle,
    'eventParticipants' | 'events' | 'participants' | 'picks' | 'providerOffers'
  >,
  logger: Pick<Console, 'error' | 'info'>,
  options: {
    listOptions?: ListLineMovementAlertsOptions;
    onSignals?: (signals: LineMovementAlertSignal[]) => void | Promise<void>;
  } = {},
) {
  return checkAndEmitLineMovementAlerts(repositories, logger, options);
}

async function checkAndEmitLineMovementAlerts(
  repositories: Pick<
    RepositoryBundle,
    'eventParticipants' | 'events' | 'participants' | 'picks' | 'providerOffers'
  >,
  logger: Pick<Console, 'error' | 'info'>,
  options: {
    listOptions?: ListLineMovementAlertsOptions;
    onSignals?: (signals: LineMovementAlertSignal[]) => void | Promise<void>;
  },
) {
  const alerts = await listLineMovementAlerts(repositories, options.listOptions);
  const newSignals = alerts.filter((signal) => !emittedSignalIds.has(signal.signalId));

  if (newSignals.length === 0) {
    return [];
  }

  for (const signal of newSignals) {
    emittedSignalIds.add(signal.signalId);
    logger.info(
      JSON.stringify({
        service: 'alert-agent',
        event: 'signal.line_movement',
        signal,
      }),
    );
  }

  if (options.onSignals) {
    await options.onSignals(newSignals);
  }

  return newSignals;
}
