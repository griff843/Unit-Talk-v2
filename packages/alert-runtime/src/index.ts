// @unit-talk/alert-runtime — shared alert agent runtime modules
// Extracted from apps/api/src/ to eliminate cross-app imports (UTV2-535).

export {
  loadAlertAgentConfig,
  loadAlertThresholds,
  detectLineMovement,
  classifyMovement,
  shouldNotify,
  runAlertDetectionPass,
  isAlertSportActive,
  ACTIVE_ALERT_SPORTS,
  SYSTEM_PICK_ELIGIBLE_MARKET_TYPES,
  SYSTEM_PICK_BLOCKED_MARKET_TYPES,
  type AlertAgentConfig,
  type AlertMarketThresholds,
  type AlertThresholdConfig,
  type AlertSignal,
  type LineMovementDetection,
  type RunAlertDetectionPassResult,
} from './alert-agent-service.js';

export {
  startAlertAgent,
  runAlertDetectionPassForTests,
} from './alert-agent.js';

export {
  runAlertNotificationPass,
  buildAlertEmbed,
  resolveDiscordChannelId,
  type AlertNotificationPassResult,
  type AlertNotificationPassOptions,
} from './alert-notification-service.js';

export {
  createAlertUpstreamAdapter,
  isSystemPickEligible,
  type AlertUpstreamAdapterOptions,
} from './alert-submission.js';

export {
  loadHedgeAgentConfig,
  runHedgeDetectionPass,
  runHedgeDetectionPassForTests,
  type HedgeAgentConfig,
  type RunHedgeDetectionPassResult,
} from './hedge-detection-service.js';

export {
  runHedgeNotificationPass,
  buildHedgeEmbed,
  type HedgeNotificationPassResult,
  type HedgeNotificationPassOptions,
} from './hedge-notification-service.js';
