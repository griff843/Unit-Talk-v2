import { createApiServer, createApiRuntimeDependencies } from './server.js';
import { startRecapScheduler } from './recap-scheduler.js';
import { startTrialExpiryScheduler } from './trial-expiry-service.js';

const defaultPort = 4000;
const port = normalizePort(process.env.PORT);
const runtime = createApiRuntimeDependencies();
const server = createApiServer({ runtime });
let stopRecapScheduler: (() => void) | null = null;
let stopTrialExpiryScheduler: (() => void) | null = null;
let shuttingDown = false;

server.listen(port, () => {
  stopRecapScheduler = startRecapScheduler(runtime.repositories);
  stopTrialExpiryScheduler = startTrialExpiryScheduler(
    runtime.repositories.tiers,
    runtime.repositories.audit,
  );

  console.log(
    JSON.stringify(
      {
        service: 'api',
        authority: 'api',
        status: 'listening',
        port,
        routes: [
          'GET /health',
          'GET /api/alerts/recent',
          'GET /api/alerts/status',
          'POST /api/submissions',
          'POST /api/grading/run',
          'POST /api/recap/post',
        ],
        persistenceMode: runtime.persistenceMode,
        runtimeMode: runtime.runtimeMode,
      },
      null,
      2,
    ),
  );
});

process.once('SIGINT', () => {
  shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  shutdown('SIGTERM');
});

function normalizePort(rawPort: string | undefined) {
  if (!rawPort) {
    return defaultPort;
  }

  const parsed = Number.parseInt(rawPort, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultPort;
  }

  return parsed;
}

function shutdown(signal: 'SIGINT' | 'SIGTERM') {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  stopRecapScheduler?.();
  stopRecapScheduler = null;
  stopTrialExpiryScheduler?.();
  stopTrialExpiryScheduler = null;

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    console.error(`Forced shutdown after ${signal}`);
    process.exit(1);
  }, 5_000).unref();
}
