import type { RepositoryBundle } from '@unit-talk/db';
import {
  loadAlertAgentConfig,
  runAlertDetectionPass,
  type AlertAgentConfig,
} from './alert-agent-service.js';

const ALERT_AGENT_INTERVAL_MS = 60_000;

export function startAlertAgent(
  repositories: Pick<RepositoryBundle, 'alertDetections' | 'events' | 'providerOffers'>,
  logger: Pick<Console, 'error' | 'info'> = console,
  config: Partial<AlertAgentConfig> = {},
) {
  const resolvedConfig = {
    ...loadAlertAgentConfig(),
    ...config,
  };

  if (!resolvedConfig.enabled) {
    logger.info(
      JSON.stringify({
        service: 'alert-agent',
        event: 'disabled',
      }),
    );

    return () => {};
  }

  const interval = setInterval(() => {
    runAlertDetectionPass(repositories, resolvedConfig)
      .then((result) => {
        logger.info(
          JSON.stringify({
            service: 'alert-agent',
            event: 'detection.pass.completed',
            result: {
              evaluatedGroups: result.evaluatedGroups,
              detections: result.detections,
              persisted: result.persisted,
              duplicateSignals: result.duplicateSignals,
              belowMinTier: result.belowMinTier,
              unresolvedEvents: result.unresolvedEvents,
              shouldNotifyCount: result.shouldNotifyCount,
            },
          }),
        );
      })
      .catch((err: unknown) => {
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

export async function runAlertDetectionPassForTests(
  repositories: Pick<RepositoryBundle, 'alertDetections' | 'events' | 'providerOffers'>,
  config: Partial<AlertAgentConfig> = {},
) {
  return runAlertDetectionPass(repositories, {
    ...loadAlertAgentConfig(),
    ...config,
  });
}
