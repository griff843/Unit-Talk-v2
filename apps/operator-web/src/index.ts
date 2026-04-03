import { loadEnvironment } from '@unit-talk/config';
import { createOperatorServer, readOperatorRuntimeMode, resolveOperatorWorkspaceRoot } from './server.js';

const port = Number.parseInt(process.env.UNIT_TALK_OPERATOR_PORT ?? '4200', 10);
const environment = loadEnvironment(resolveOperatorWorkspaceRoot());
const runtimeMode = readOperatorRuntimeMode(environment);
const server = createOperatorServer();

server.listen(port, () => {
  console.log(
    JSON.stringify(
      {
        service: 'operator-web',
        status: 'ready',
        port,
        runtimeMode,
        routes: ['/', '/health', '/api/operator/snapshot'],
      },
      null,
      2,
    ),
  );
});
