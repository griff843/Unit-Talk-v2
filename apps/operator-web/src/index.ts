import { createOperatorServer, readOperatorRuntimeMode } from './server.js';

const port = Number.parseInt(process.env.UNIT_TALK_OPERATOR_PORT ?? '4200', 10);
const runtimeMode = readOperatorRuntimeMode();
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
