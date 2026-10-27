import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedMediaUrl, parseParticipantMedia, fetchParticipantMedia, participantInitials, mediaTeamParticipantId } from '../lib/participant-media.js';

const player = { participantId: 'player-1', participantType: 'player', displayName: 'Anthony Edwards', sport: 'NBA',
  headshotUrl: 'https://cdn.nba.com/headshots/nba/latest/1040x760/1630162.png', logoUrl: null };

test('media only belongs to the exact selected participant, type and sport', () => {
  assert.deepEqual(parseParticipantMedia(player, 'player-1', 'player', 'NBA'), player);
  assert.equal(parseParticipantMedia(player, 'player-2', 'player', 'NBA'), null);
  assert.equal(parseParticipantMedia(player, 'player-1', 'team', 'NBA'), null);
  assert.equal(parseParticipantMedia(player, 'player-1', 'player', 'NHL'), null);
  assert.equal(parseParticipantMedia(null, 'player-1', 'player', 'NBA'), null);
});

test('unapproved media never becomes an image source', () => {
  for (const url of ['http://cdn.nba.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,abc',
    'https://cdn.nba.com.evil.test/a.png', 'https://user:secret@cdn.nba.com/a.png', 'https://cdn.nba.com:444/a.png']) {
    assert.equal(approvedMediaUrl(url), null);
  }
  assert.equal(parseParticipantMedia({ ...player, headshotUrl: 'https://unapproved.test/a.png' }, 'player-1', 'player', 'NBA')?.headshotUrl, null);
});

test('missing identities, rejected lookups and network errors yield optional empty media', async () => {
  const controller = new AbortController();
  let calls = 0;
  const failing: typeof fetch = async () => { calls++; throw new Error('offline'); };
  assert.equal(await fetchParticipantMedia(null, 'player', 'NBA', controller.signal, failing), null);
  assert.equal(calls, 0);
  assert.equal(await fetchParticipantMedia('player-1', 'player', 'NBA', controller.signal, failing), null);
  const absent: typeof fetch = async () => new Response('', { status: 404 });
  assert.equal(await fetchParticipantMedia('player-1', 'player', 'NBA', controller.signal, absent), null);
});

test('lookup encodes exact identity and rejects mismatched server data', async () => {
  const controller = new AbortController();
  const fetcher: typeof fetch = async (url, options) => {
    assert.match(String(url), /participants\/player%2F1\/media$/);
    assert.equal(options?.signal, controller.signal);
    return Response.json({ data: player });
  };
  assert.equal(await fetchParticipantMedia('player/1', 'player', 'NBA', controller.signal, fetcher), null);
});

test('initials fallback handles empty and long participant names', () => {
  assert.equal(participantInitials(' Anthony Edwards '), 'AE');
  assert.equal(participantInitials('Minnesota Timberwolves'), 'MT');
  assert.equal(participantInitials(''), '');
});

test('media maps legacy team keys to exact participant IDs without name matching', () => {
  const teams = [{ participantId: 'canonical-participant', teamId: 'legacy-team' }];
  assert.equal(mediaTeamParticipantId('legacy-team', teams), 'canonical-participant');
  assert.equal(mediaTeamParticipantId('canonical-participant', teams), 'canonical-participant');
  assert.equal(mediaTeamParticipantId('structured-team', []), 'structured-team');
  assert.equal(mediaTeamParticipantId(null, teams), null);
});
