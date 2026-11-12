import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { createApiServer } from './server.js';

test('GET participant media is exposed through the reference-data route', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const player = await repositories.participants.upsertByExternalId({ externalId: 'http-player', displayName: 'HTTP Player', participantType: 'player', sport: 'NBA', metadata: { headshot_url: 'https://cdn.nba.com/player.png' } });
  const server = createApiServer({ repositories });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reference-data/participants/${player.id}/media`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, data: { participantId: player.id, participantType: 'player', displayName: 'HTTP Player', sport: 'NBA', headshotUrl: 'https://cdn.nba.com/player.png' } });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/reference-data/participants/not-a-uuid/media`)).status, 404);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
