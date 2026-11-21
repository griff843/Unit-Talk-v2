import assert from 'node:assert/strict';
import test from 'node:test';
import type { ParticipantRepository, ParticipantRow } from '@unit-talk/db';
import {
  isTwoTeamMarket,
  PICK_ARTWORK_DEADLINE_MS,
  resolvePickArtwork,
  type PickArtworkOptions,
} from './pick-asset-resolver.js';
import type { HeadshotResolution } from './player-enrichment-service.js';

// WORK-2026110302: artwork binds to canonical participant identity, is verified
// against a fresh #1822 re-resolve, and never writes back to participants.

const LEBRON_URL = 'https://cdn.nba.com/headshots/nba/latest/1040x760/2544.png';
const BRONNY_URL = 'https://cdn.nba.com/headshots/nba/latest/1040x760/1642355.png';
const LAKERS_LOGO = 'https://a.espncdn.com/i/teamlogos/nba/500/lal.png';

function row(overrides: Partial<ParticipantRow> & Pick<ParticipantRow, 'id' | 'display_name'>): ParticipantRow {
  return {
    external_id: `ext-${overrides.id}`,
    league: 'NBA',
    metadata: {},
    participant_type: 'player',
    sport: 'NBA',
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as ParticipantRow;
}

interface SpyRepo extends ParticipantRepository {
  findByIdCalls: string[];
  listByTypeCalls: number;
  updateMetadataCalls: number;
}

function repo(rows: ParticipantRow[]): SpyRepo {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const spy: SpyRepo = {
    findByIdCalls: [],
    listByTypeCalls: 0,
    updateMetadataCalls: 0,
    async upsertByExternalId() {
      throw new Error('not used');
    },
    async findById(id: string) {
      spy.findByIdCalls.push(id);
      return byId.get(id) ?? null;
    },
    async findByExternalId() {
      return null;
    },
    async listByType() {
      spy.listByTypeCalls += 1;
      return rows;
    },
    async updateMetadata() {
      spy.updateMetadataCalls += 1;
      throw new Error('artwork resolution must never write to participants');
    },
  };
  return spy;
}

function headshot(result: HeadshotResolution): PickArtworkOptions & { calls: Array<{ name: string; sport: string | null }> } {
  const calls: Array<{ name: string; sport: string | null }> = [];
  return {
    calls,
    resolveHeadshot: async (name, sport) => {
      calls.push({ name, sport });
      return result;
    },
  };
}

const lebron = row({
  id: 'p-lebron',
  display_name: 'LeBron James',
  metadata: { headshot_url: LEBRON_URL, team_abbrev: 'LAL' },
});
const bronny = row({
  id: 'p-bronny',
  display_name: 'Bronny James',
  metadata: { headshot_url: BRONNY_URL, team_abbrev: 'LAL' },
});
const lakers = row({
  id: 't-lakers',
  display_name: 'Los Angeles Lakers',
  participant_type: 'team',
  metadata: { logo_url: LAKERS_LOGO, abbreviation: 'LAL' },
});

test('WORK-2026110302: a player headshot is verified when a fresh re-resolve confirms the stored URL', async () => {
  const participants = repo([lebron]);
  const opts = headshot({ url: LEBRON_URL, reason: 'confirmed' });
  const artwork = await resolvePickArtwork(
    { participantId: 'p-lebron', marketKey: 'player_points_ou' },
    participants,
    opts,
  );
  assert.deepEqual(artwork, { url: LEBRON_URL, verified: true });
  assert.deepEqual(opts.calls, [{ name: 'LeBron James', sport: 'NBA' }]);
  assert.equal(participants.listByTypeCalls, 0, 'never scans participants by selection text');
});

test('WORK-2026110302: an ambiguous name gives no thumbnail', async () => {
  const artwork = await resolvePickArtwork(
    { participantId: 'p-lebron', marketKey: 'player_points_ou' },
    repo([lebron]),
    headshot({ url: null, reason: 'ambiguous' }),
  );
  assert.deepEqual(artwork, { url: null, verified: false });
});

test('WORK-2026110302: an identity mismatch or null re-resolve gives no thumbnail', async () => {
  for (const result of [
    { url: null, reason: 'identity-mismatch' },
    { url: null, reason: 'unresolved' },
  ] as HeadshotResolution[]) {
    const artwork = await resolvePickArtwork(
      { participantId: 'p-lebron', marketKey: 'player_points_ou' },
      repo([lebron]),
      headshot(result),
    );
    assert.deepEqual(artwork, { url: null, verified: false }, result.reason);
  }
});

test('WORK-2026110302: a shared stored URL (another player\'s photo) gives no thumbnail', async () => {
  // Bronny's row carries LeBron's photo; the fresh re-resolve for Bronny disagrees.
  const sharedBronny = row({ ...bronny, metadata: { headshot_url: LEBRON_URL } });
  const artwork = await resolvePickArtwork(
    { participantId: 'p-bronny', marketKey: 'player_points_ou' },
    repo([lebron, sharedBronny]),
    headshot({ url: BRONNY_URL, reason: 'confirmed' }),
  );
  assert.deepEqual(artwork, { url: null, verified: false });
});

test('WORK-2026110302: the selected participant is the identified one, never an unrelated player', async () => {
  // Selection text would name LeBron; identity is Bronny. Only Bronny is ever considered.
  const participants = repo([lebron, bronny]);
  const opts = headshot({ url: BRONNY_URL, reason: 'confirmed' });
  const artwork = await resolvePickArtwork(
    { participantId: 'p-bronny', marketKey: 'player_points_ou' },
    participants,
    opts,
  );
  assert.deepEqual(artwork, { url: BRONNY_URL, verified: true });
  assert.deepEqual(participants.findByIdCalls, ['p-bronny']);
  assert.deepEqual(opts.calls.map((c) => c.name), ['Bronny James']);
});

test('WORK-2026110302: no participant ID gives no thumbnail and no lookup', async () => {
  const participants = repo([lebron, lakers]);
  for (const participantId of [null, undefined, '', '   ']) {
    const artwork = await resolvePickArtwork(
      { participantId, marketKey: 'player_points_ou' },
      participants,
      headshot({ url: LEBRON_URL, reason: 'confirmed' }),
    );
    assert.deepEqual(artwork, { url: null, verified: false });
  }
  assert.equal(participants.findByIdCalls.length, 0);
  assert.equal(participants.listByTypeCalls, 0);
});

test('WORK-2026110302: an unknown participant ID gives no thumbnail', async () => {
  const artwork = await resolvePickArtwork(
    { participantId: 'p-missing', marketKey: 'player_points_ou' },
    repo([lebron]),
    headshot({ url: LEBRON_URL, reason: 'confirmed' }),
  );
  assert.deepEqual(artwork, { url: null, verified: false });
});

test('WORK-2026110302: a dead NHL host gives no thumbnail and skips the re-resolve', async () => {
  const mcdavid = row({
    id: 'p-mcdavid',
    display_name: 'Connor McDavid',
    sport: 'NHL',
    league: 'NHL',
    metadata: { headshot_url: 'https://cms.nhl.bamgrid.com/images/headshots/current/168x168/8478402.jpg' },
  });
  const opts = headshot({
    url: 'https://cms.nhl.bamgrid.com/images/headshots/current/168x168/8478402.jpg',
    reason: 'confirmed',
  });
  const artwork = await resolvePickArtwork(
    { participantId: 'p-mcdavid', marketKey: 'player_points_ou' },
    repo([mcdavid]),
    opts,
  );
  assert.deepEqual(artwork, { url: null, verified: false });
  assert.equal(opts.calls.length, 0);
});

test('WORK-2026110302: a team pick uses the identified team\'s own logo', async () => {
  const artwork = await resolvePickArtwork(
    { participantId: 't-lakers', marketKey: 'moneyline' },
    repo([lakers]),
    headshot({ url: null, reason: 'unresolved' }),
  );
  assert.deepEqual(artwork, { url: LAKERS_LOGO, verified: true });
});

test('WORK-2026110302: a team logo on a foreign host gives no thumbnail', async () => {
  const foreign = row({ ...lakers, metadata: { logo_url: 'https://example.com/lal.png' } });
  const artwork = await resolvePickArtwork(
    { participantId: 't-lakers', marketKey: 'spread' },
    repo([foreign]),
  );
  assert.deepEqual(artwork, { url: null, verified: false });
});

test('WORK-2026110302: a two-team game total gives no thumbnail even with a team participant', async () => {
  for (const marketKey of ['game_total_ou', 'total', 'totals', 'game_total', 'NBA total']) {
    const participants = repo([lakers]);
    const artwork = await resolvePickArtwork({ participantId: 't-lakers', marketKey }, participants);
    assert.deepEqual(artwork, { url: null, verified: false }, marketKey);
    assert.equal(participants.findByIdCalls.length, 0, marketKey);
  }
});

test('WORK-2026110302: isTwoTeamMarket keeps team totals and player props eligible', () => {
  for (const key of ['team_total_ou', 'team_total', 'player_points_ou', 'player_total_bases', 'moneyline', 'spread']) {
    assert.equal(isTwoTeamMarket(key), false, key);
  }
  assert.equal(isTwoTeamMarket(null), false);
});

test('WORK-2026110302: a provider that never returns gives no thumbnail within the deadline', async () => {
  const started = Date.now();
  const artwork = await resolvePickArtwork(
    { participantId: 'p-lebron', marketKey: 'player_points_ou' },
    repo([lebron]),
    { deadlineMs: 50, resolveHeadshot: () => new Promise<HeadshotResolution>(() => {}) },
  );
  assert.deepEqual(artwork, { url: null, verified: false });
  assert.ok(Date.now() - started < 1_000);
});

test('WORK-2026110302: a participant lookup that never returns shares the same deadline', async () => {
  const hanging = {
    findById: () => new Promise<ParticipantRow | null>(() => {}),
  };
  const started = Date.now();
  const artwork = await resolvePickArtwork(
    { participantId: 'p-lebron', marketKey: 'player_points_ou' },
    hanging,
    { deadlineMs: 50 },
  );
  assert.deepEqual(artwork, { url: null, verified: false });
  assert.ok(Date.now() - started < 1_000);
});

test('WORK-2026110302: the default overall artwork deadline is five seconds', () => {
  assert.equal(PICK_ARTWORK_DEADLINE_MS, 5_000);
});

test('WORK-2026110302: a throwing provider or repository gives no thumbnail', async () => {
  assert.deepEqual(
    await resolvePickArtwork(
      { participantId: 'p-lebron', marketKey: 'player_points_ou' },
      repo([lebron]),
      { resolveHeadshot: async () => { throw new Error('provider down'); } },
    ),
    { url: null, verified: false },
  );
  assert.deepEqual(
    await resolvePickArtwork(
      { participantId: 'p-lebron', marketKey: 'player_points_ou' },
      { findById: async () => { throw new Error('db down'); } },
    ),
    { url: null, verified: false },
  );
});

test('WORK-2026110302: artwork resolution never calls updateMetadata', async () => {
  const unstored = row({ id: 'p-new', display_name: 'New Player', metadata: {} });
  const participants = repo([unstored, lebron, lakers]);
  const confirmed = headshot({ url: LEBRON_URL, reason: 'confirmed' });
  await resolvePickArtwork({ participantId: 'p-new', marketKey: 'player_points_ou' }, participants, confirmed);
  await resolvePickArtwork({ participantId: 'p-lebron', marketKey: 'player_points_ou' }, participants, confirmed);
  await resolvePickArtwork({ participantId: 't-lakers', marketKey: 'moneyline' }, participants, confirmed);
  assert.equal(participants.updateMetadataCalls, 0);
});
