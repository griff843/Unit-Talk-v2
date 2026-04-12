import type {
  AlertDetectionRecord,
  HedgeOpportunityRecord,
  RepositoryBundle,
} from '@unit-talk/db';
import {
  loadAlertAgentConfig,
  runAlertDetectionPass,
  type AlertAgentConfig,
} from './alert-agent-service.js';
import { runAlertNotificationPass } from './alert-notification-service.js';
import { createAlertUpstreamAdapter } from './alert-submission.js';
import {
  type HedgeAgentConfig,
  loadHedgeAgentConfig,
  runHedgeDetectionPass,
} from './hedge-detection-service.js';
import { runHedgeNotificationPass } from './hedge-notification-service.js';

const ALERT_AGENT_INTERVAL_MS = 60_000;
type AlertAgentRuntimeConfig = Partial<AlertAgentConfig & HedgeAgentConfig> & {
  systemPicksEnabled?: boolean;
};

export function startAlertAgent(
  repositories: Pick<
    RepositoryBundle,
    'alertDetections' | 'hedgeOpportunities' | 'events' | 'participants' | 'providerOffers' | 'runs' | 'audit' | 'marketUniverse'
  >,
  logger: Pick<Console, 'error' | 'info'> = console,
  config: AlertAgentRuntimeConfig = {},
) {
  const resolvedAlertConfig = {
    ...loadAlertAgentConfig(),
    ...config,
  };
  const resolvedHedgeConfig = {
    ...loadHedgeAgentConfig(),
    ...config,
  };
  // Phase 7B UTV2-496/512: governed upstream adapter replaces direct /api/submissions POST
  const publishSystemPick = createAlertUpstreamAdapter({
    enabled: config.systemPicksEnabled === true,
    events: repositories.events,
    participants: repositories.participants,
    marketUniverse: repositories.marketUniverse,
    logger,
  });

  if (!resolvedAlertConfig.enabled && !resolvedHedgeConfig.enabled) {
    logger.info(
      JSON.stringify({
        service: 'alert-agent',
        event: 'disabled',
      }),
    );

    return () => {};
  }

  const interval = setInterval(() => {
    void runAlertAgentTick(
      repositories,
      logger,
      resolvedAlertConfig,
      resolvedHedgeConfig,
      publishSystemPick,
    );
  }, ALERT_AGENT_INTERVAL_MS);

  return () => {
    clearInterval(interval);
  };
}

export async function runAlertDetectionPassForTests(
  repositories: Pick<RepositoryBundle, 'alertDetections' | 'events' | 'providerOffers' | 'runs'>,
  config: Partial<AlertAgentConfig> = {},
) {
  return runAlertDetectionPass(repositories, {
    ...loadAlertAgentConfig(),
    ...config,
  });
}

async function runAlertAgentTick(
  repositories: Pick<
    RepositoryBundle,
    'alertDetections' | 'hedgeOpportunities' | 'events' | 'participants' | 'providerOffers' | 'runs' | 'audit'
  >,
  logger: Pick<Console, 'error' | 'info'>,
  alertConfig: ReturnType<typeof loadAlertAgentConfig>,
  hedgeConfig: ReturnType<typeof loadHedgeAgentConfig>,
  publishSystemPick: (detection: AlertDetectionRecord) => Promise<void>,
) {
  let alertPersistedSignals: AlertDetectionRecord[] = [];
  let hedgePersistedOpportunities: HedgeOpportunityRecord[] = [];

  try {
    const detectionResult = await runAlertDetectionPass(repositories, alertConfig);
    alertPersistedSignals = detectionResult.persistedSignals;

    logger.info(
      JSON.stringify({
        service: 'alert-agent',
        event: 'detection.pass.completed',
        result: {
          evaluatedGroups: detectionResult.evaluatedGroups,
          detections: detectionResult.detections,
          persisted: detectionResult.persisted,
          duplicateSignals: detectionResult.duplicateSignals,
          belowMinTier: detectionResult.belowMinTier,
          unresolvedEvents: detectionResult.unresolvedEvents,
          shouldNotifyCount: detectionResult.shouldNotifyCount,
        },
      }),
    );
  } catch (err: unknown) {
    logger.error(
      JSON.stringify({
        service: 'alert-agent',
        event: 'alert_detection.tick_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  try {
    const hedgeDetectionResult = await runHedgeDetectionPass(repositories, hedgeConfig);
    hedgePersistedOpportunities = hedgeDetectionResult.persistedOpportunities;

    logger.info(
      JSON.stringify({
        service: 'alert-agent',
        event: 'hedge_detection.pass.completed',
        result: {
          evaluatedGroups: hedgeDetectionResult.evaluatedGroups,
          opportunities: hedgeDetectionResult.opportunities,
          persisted: hedgeDetectionResult.persisted,
          duplicateOpportunities: hedgeDetectionResult.duplicateOpportunities,
          unresolvedEvents: hedgeDetectionResult.unresolvedEvents,
        },
      }),
    );
  } catch (err: unknown) {
    logger.error(
      JSON.stringify({
        service: 'alert-agent',
        event: 'hedge_detection.tick_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  if (alertPersistedSignals.length > 0) {
    try {
      const notificationResult = await runAlertNotificationPass(
        alertPersistedSignals,
        repositories.alertDetections,
        {
          dryRun: alertConfig.dryRun,
          audit: repositories.audit,
          runs: repositories.runs,
          onNotified: publishSystemPick,
        },
      );

      logger.info(
        JSON.stringify({
          service: 'alert-agent',
          event: 'notification.pass.completed',
          result: notificationResult,
        }),
      );
    } catch (err: unknown) {
      logger.error(
        JSON.stringify({
          service: 'alert-agent',
          event: 'notification.tick_failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  if (hedgePersistedOpportunities.length > 0) {
    try {
      const notificationResult = await runHedgeNotificationPass(
        hedgePersistedOpportunities,
        repositories.hedgeOpportunities,
        { dryRun: hedgeConfig.dryRun },
      );

      logger.info(
        JSON.stringify({
          service: 'alert-agent',
          event: 'hedge_notification.pass.completed',
          result: notificationResult,
        }),
      );
    } catch (err: unknown) {
      logger.error(
        JSON.stringify({
          service: 'alert-agent',
          event: 'hedge_notification.tick_failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
