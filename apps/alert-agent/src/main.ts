// Entry point for the alert agent process.
// Run with: node dist/main.js (or tsx src/main.ts in dev)

import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createInMemoryRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { loadAlertAgentConfig, startAlertAgent } from '@unit-talk/alert-runtime';

const environment = loadEnvironment();
let persistenceMode: 'database' | 'in_memory';
let repositories;

try {
  const connection = createServiceRoleDatabaseConnectionConfig(environment);
  repositories = createDatabaseRepositoryBundle(connection);
  persistenceMode = 'database';
} catch {
  repositories = createInMemoryRepositoryBundle();
  persistenceMode = 'in_memory';
}

const alertConfig = loadAlertAgentConfig(process.env);
let stop: (() => void) | null = null;
let shuttingDown = false;

// Phase 7B UTV2-496/512: governed upstream adapter — no HTTP submission config needed
stop = startAlertAgent(repositories, console, {
  systemPicksEnabled: process.env.SYSTEM_PICKS_ENABLED === 'true',
});

console.log(
  JSON.stringify({
    service: 'alert-agent',
    status: 'started',
    persistenceMode,
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
