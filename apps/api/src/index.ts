import { createApiServer, createApiRuntimeDependencies } from './server.js';

const defaultPort = 4000;
const port = normalizePort(process.env.PORT);
const runtime = createApiRuntimeDependencies();
const server = createApiServer({ repositories: runtime.repositories });

server.listen(port, () => {
  console.log(
    JSON.stringify(
      {
        service: 'api',
        authority: 'api',
        status: 'listening',
        port,
        routes: ['GET /health', 'POST /api/submissions'],
        persistenceMode: runtime.persistenceMode,
      },
      null,
      2,
    ),
  );
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
