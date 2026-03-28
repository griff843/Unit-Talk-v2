import { createApiServer, createApiRuntimeDependencies } from './server.js';
import { startAlertAgent } from './alert-agent.js';
import { startRecapScheduler } from './recap-scheduler.js';

const defaultPort = 4000;
const port = normalizePort(process.env.PORT);
const runtime = createApiRuntimeDependencies();
const server = createApiServer({ runtime });
let stopRecapScheduler: (() => void) | null = null;
let stopAlertAgent: (() => void) | null = null;
let shuttingDown = false;

server.listen(port, () => {
  stopRecapScheduler = startRecapScheduler(runtime.repositories);
  stopAlertAgent = startAlertAgent(runtime.repositories);

  console.log(
    JSON.stringify(
      {
        service: 'api',
        authority: 'api',
        status: 'listening',
        port,
        routes: [
          'GET /health',
          'POST /api/submissions',
          'POST /api/grading/run',
          'POST /api/recap/post',
        ],
        persistenceMode: runtime.persistenceMode,
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
  stopAlertAgent?.();
  stopAlertAgent = null;

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    console.error(`Forced shutdown after ${signal}`);
    process.exit(1);
  }, 5_000).unref();
}
