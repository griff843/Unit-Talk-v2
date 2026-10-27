import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from '../persistence.js';
import { handleGetParticipantMedia, normalizeParticipantMediaUrl } from './participant-media.js';

test('projects approved player media by canonical id', async () => {
  const { participants } = createInMemoryRepositoryBundle();
  const player = await participants.upsertByExternalId({ externalId: 'p', displayName: 'Player', participantType: 'player', sport: 'NBA', metadata: { headshot_url: 'https://cdn.nba.com/player.png', logo_url: 'https://a.espncdn.com/team.png', private: true } });
  assert.deepEqual(await handleGetParticipantMedia(player.id, participants), { status: 200, body: { ok: true, data: { participantId: player.id, participantType: 'player', displayName: 'Player', sport: 'NBA', headshotUrl: 'https://cdn.nba.com/player.png' } } });
});

test('projects only team logo and rejects invalid ids without repository access', async () => {
  const { participants } = createInMemoryRepositoryBundle();
  const team = await participants.upsertByExternalId({ externalId: 't', displayName: 'Team', participantType: 'team', sport: 'NHL', metadata: { logo_url: 'https://assets.nhle.com/team.svg', headshot_url: 'https://cdn.nba.com/player.png' } });
  assert.deepEqual(await handleGetParticipantMedia(team.id, participants), { status: 200, body: { ok: true, data: { participantId: team.id, participantType: 'team', displayName: 'Team', sport: 'NHL', logoUrl: 'https://assets.nhle.com/team.svg' } } });
  let calls = 0;
  assert.equal((await handleGetParticipantMedia('not-a-uuid', { findById: async () => { calls += 1; return null; } })).status, 404);
  assert.equal(calls, 0);
});

test('returns 404 for unknown, mismatched, or unsupported participants and 503 for repository failures', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal((await handleGetParticipantMedia(id, { findById: async () => null })).status, 404);
  assert.equal((await handleGetParticipantMedia(id, { findById: async () => ({ id: '00000000-0000-4000-8000-000000000002', participant_type: 'player', display_name: 'x', sport: null, metadata: {} } as never) })).status, 404);
  assert.equal((await handleGetParticipantMedia(id, { findById: async () => { throw new Error('secret'); } })).status, 503);
});

test('media URL policy allows approved HTTPS origins and rejects unsafe URLs', () => {
  assert.equal(normalizeParticipantMediaUrl('https://a.espncdn.com/image.png'), 'https://a.espncdn.com/image.png');
  for (const value of ['http://cdn.nba.com/x.png', 'https://cdn.nba.com:444/x.png', 'https://user:pass@cdn.nba.com/x.png', 'https://evil.example/cdn.nba.com/x.png', 'https://cdn.nba.com/x.png#fragment']) assert.equal(normalizeParticipantMediaUrl(value), null);
});
