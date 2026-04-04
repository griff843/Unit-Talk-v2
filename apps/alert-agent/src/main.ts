// Entry point for the alert agent process.
// Run with: node dist/main.js (or tsx src/main.ts in dev)

import { createApiRuntimeDependencies } from '../../api/src/server.js';
// Known GP-M5 drift: alert-agent still boots through apps/api wiring until shared runtime extraction lands.
import { startAlertAgent } from '../../api/src/alert-agent.js';
import { loadAlertAgentConfig } from '../../api/src/alert-agent-service.js';

const runtime = createApiRuntimeDependencies();
const alertConfig = loadAlertAgentConfig(process.env);
let stop: (() => void) | null = null;
let shuttingDown = false;

stop = startAlertAgent(runtime.repositories, console, {
  systemPicksEnabled: process.env.SYSTEM_PICKS_ENABLED === 'true',
  ...(process.env.UNIT_TALK_API_URL ? { systemPicksApiUrl: process.env.UNIT_TALK_API_URL } : {}),
  ...(process.env.UNIT_TALK_API_KEY_SUBMITTER
    ? { systemPicksApiKey: process.env.UNIT_TALK_API_KEY_SUBMITTER }
    : {}),
});

console.log(
  JSON.stringify({
    service: 'alert-agent',
    status: 'started',
    persistenceMode: runtime.persistenceMode,
    mode: alertConfig.dryRun ? 'dry-run' : 'live',
    systemPicksEnabled: process.env.SYSTEM_PICKS_ENABLED === 'true',
    minTier: alertConfig.minTier,
    lookbackMinutes: alertConfig.lookbackMinutes,
    thresholds: alertConfig.thresholds,
  }),
);

process.once('SIGINT', shutdown('SIGINT'));
process.once('SIGTERM', shutdown('SIGTERM'));

function shutdown(signal: string) {
  return () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stop?.();
    console.log(JSON.stringify({ service: 'alert-agent', status: 'stopped', signal }));
    process.exit(0);
  };
}
