// Re-export from @unit-talk/alert-runtime (UTV2-535: cross-app import extraction).
// Tests and query services in apps/api still import from this path.
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
} from '@unit-talk/alert-runtime';
