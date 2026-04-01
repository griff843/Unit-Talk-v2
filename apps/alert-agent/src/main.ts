// Entry point for the alert agent process.
// Run with: node dist/main.js (or tsx src/main.ts in dev)

import {
  createConsoleLogWriter,
  createDualLogWriter,
  createLogger,
  createLokiLogWriter,
} from '@unit-talk/observability';
import { createApiRuntimeDependencies } from '../../api/src/server.js';
import { startAlertAgent } from '../../api/src/alert-agent.js';

const lokiUrl = process.env.LOKI_URL?.trim();
const alertWriter = lokiUrl
  ? createDualLogWriter(createConsoleLogWriter(), createLokiLogWriter({ url: lokiUrl }))
  : undefined;
const logger = createLogger({ service: 'alert-agent', ...(alertWriter ? { writer: alertWriter } : {}) });

const runtime = createApiRuntimeDependencies();
let stop: (() => void) | null = null;
let shuttingDown = false;

stop = startAlertAgent(runtime.repositories);

console.log(
  JSON.stringify({
    service: 'alert-agent',
    status: 'started',
    persistenceMode: runtime.persistenceMode,
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
