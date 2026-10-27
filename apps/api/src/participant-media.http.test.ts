import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { createApiServer } from './server.js';

test('GET participant media exposes exact canonical artwork through the public reference route', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const player = await repositories.participants.upsertByExternalId({
    externalId: 'nhl-player', displayName: 'Example NHL Player', participantType: 'player', sport: 'NHL',
    metadata: { headshot_url: 'https://cms.nhl.bamgrid.com/images/headshots/current/168x168/123.jpg', private_notes: 'hidden' },
  });
  const server = createApiServer({ repositories });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reference-data/participants/${player.id}/media`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, data: {
      participantId: player.id, participantType: 'player', displayName: 'Example NHL Player', sport: 'NHL',
      headshotUrl: 'https://cms.nhl.bamgrid.com/images/headshots/current/168x168/123.jpg', logoUrl: null,
    } });
    const missing = await fetch(`http://127.0.0.1:${port}/api/reference-data/participants/unknown/media`);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
