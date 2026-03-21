import { createSmartFormServer } from './server.js';

const port = Number.parseInt(process.env.UNIT_TALK_SMART_FORM_PORT ?? '4100', 10);
const server = createSmartFormServer();

server.listen(port, () => {
  console.log(
    JSON.stringify(
      {
        service: 'smart-form',
        status: 'ready',
        port,
        routes: ['/', '/health', '/submit'],
      },
      null,
      2,
    ),
  );
});
