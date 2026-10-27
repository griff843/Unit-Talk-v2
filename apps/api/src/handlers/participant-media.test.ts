import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from '../persistence.js';
import { handleGetParticipantMedia, normalizeParticipantMediaUrl } from './participant-media.js';

test('participant media projects only exact player identity and approved stored artwork', async () => {
  const { participants } = createInMemoryRepositoryBundle();
  const player = await participants.upsertByExternalId({
    externalId: 'nba-player', displayName: 'Example Player', participantType: 'player', sport: 'NBA',
    metadata: {
      headshot_url: 'https://cdn.nba.com/headshots/nba/latest/1040x760/123.png',
      logo_url: 'https://a.espncdn.com/i/teamlogos/nba/500/min.png',
      internal_notes: 'must never leave the API',
    },
  });
  const result = await handleGetParticipantMedia(player.id, participants);
  assert.deepEqual(result, {
    status: 200, body: { ok: true, data: {
      participantId: player.id, participantType: 'player', displayName: 'Example Player', sport: 'NBA',
      headshotUrl: 'https://cdn.nba.com/headshots/nba/latest/1040x760/123.png', logoUrl: null,
    } },
  });
  assert.equal((await handleGetParticipantMedia('nba-player', participants)).status, 404);
});

test('team media returns a team logo without presenting a stored headshot as a player', async () => {
  const { participants } = createInMemoryRepositoryBundle();
  const team = await participants.upsertByExternalId({
    externalId: 'nhl-team', displayName: 'Example Team', participantType: 'team', sport: 'NHL',
    metadata: { logo_url: 'https://assets.nhle.com/logos/nhl/svg/EDM_light.svg', headshot_url: 'https://cdn.nba.com/player.png' },
  });
  const result = await handleGetParticipantMedia(team.id, participants);
  assert.equal(result.body.ok, true);
  if (result.body.ok) {
    assert.equal(result.body.data.logoUrl, 'https://assets.nhle.com/logos/nhl/svg/EDM_light.svg');
    assert.equal(result.body.data.headshotUrl, null);
  }
});

test('all existing enriched image CDN origins are supported', () => {
  for (const host of ['cdn.nba.com', 'img.mlbstatic.com', 'a.espncdn.com', 'cms.nhl.bamgrid.com', 'assets.nhle.com']) {
    assert.equal(normalizeParticipantMediaUrl(`https://${host}/image.png`), `https://${host}/image.png`);
  }
  assert.equal(normalizeParticipantMediaUrl('https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/123.png&w=350&h=254'), 'https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/123.png&w=350&h=254');
});

test('media URL policy rejects unsafe or unapproved values', () => {
  for (const value of [
    null, {}, 123, '', 'not a url', '//cdn.nba.com/player.png',
    'http://cdn.nba.com/player.png', 'data:image/png;base64,abc',
    'https://cdn.nba.com.evil.example/player.png', 'https://evil.example/cdn.nba.com/player.png',
    'https://user:password@cdn.nba.com/player.png', 'https://cdn.nba.com:444/player.png',
    'https://cdn.nba.com/player.png#fragment',
  ]) assert.equal(normalizeParticipantMediaUrl(value), null, String(value));
});

test('missing and invalid artwork remains optional', async () => {
  const { participants } = createInMemoryRepositoryBundle();
  for (const metadata of [{}, { headshot_url: { href: 'https://cdn.nba.com/player.png' } }, { headshot_url: 'https://other.example/player.png' }]) {
    const player = await participants.upsertByExternalId({
      externalId: JSON.stringify(metadata), displayName: 'No Artwork', participantType: 'player', metadata,
    });
    const result = await handleGetParticipantMedia(player.id, participants);
    assert.equal(result.status, 200);
    if (result.body.ok) {
      assert.equal(result.body.data.headshotUrl, null);
      assert.equal(result.body.data.logoUrl, null);
    }
  }
});

test('lookup handles unknown, mismatched and failing repository results without leaking details', async () => {
  assert.equal((await handleGetParticipantMedia('missing', { findById: async () => null })).status, 404);
  const { participants } = createInMemoryRepositoryBundle();
  const row = await participants.upsertByExternalId({ externalId: 'id', displayName: 'Player', participantType: 'player', metadata: {} });
  assert.equal((await handleGetParticipantMedia('other-id', { findById: async () => row })).status, 404);
  const failure = await handleGetParticipantMedia('id', { findById: async () => { throw new Error('secret connection details'); } });
  assert.deepEqual(failure, { status: 503, body: { ok: false, error: {
    code: 'PARTICIPANT_MEDIA_UNAVAILABLE', message: 'Participant artwork is temporarily unavailable',
  } } });
});
