import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHeadshotUrl, runPlayerEnrichmentPass, type PlayerEnrichmentDeps } from './player-enrichment-service.js';

// ── resolveHeadshotUrl ─────────────────────────────────────────────

test('resolveHeadshotUrl returns null for null sport', async () => {
  const result = await resolveHeadshotUrl('Test Player', null, null);
  assert.equal(result, null);
});

test('resolveHeadshotUrl returns null for unknown sport', async () => {
  const result = await resolveHeadshotUrl('Test Player', 'CRICKET', null);
  assert.equal(result, null);
});

// ── runPlayerEnrichmentPass ────────────────────────────────────────

function createFakeParticipantRepo(players: Array<Record<string, unknown>>) {
  const store = new Map<string, Record<string, unknown>>();
  for (const p of players) store.set(p['id'] as string, { ...p });

  return {
    async listByType() { return Array.from(store.values()); },
    async updateMetadata(id: string, metadata: Record<string, unknown>) {
      const existing = store.get(id);
      if (!existing) throw new Error('Not found');
      const merged = { ...(existing['metadata'] as Record<string, unknown> ?? {}), ...metadata };
      const updated = { ...existing, metadata: merged };
      store.set(id, updated);
      return updated;
    },
    async findById(id: string) { return store.get(id) ?? null; },
    async findByExternalId() { return null; },
    async upsertByExternalId() { return {} as never; },
    getStore() { return store; },
  };
}

function createFakeRunsRepo() {
  const runs: Array<Record<string, unknown>> = [];
  return {
    async startRun(input: Record<string, unknown>) {
      const run = { id: 'run-1', run_type: input['runType'], status: 'running', ...input };
      runs.push(run);
      return run;
    },
    async completeRun(input: Record<string, unknown>) {
      const run = runs.find((r) => r['id'] === input['runId']) ?? runs[runs.length - 1];
      if (run) {
        run['status'] = input['status'];
        run['details'] = input['details'];
      }
      return run;
    },
    async listByType() { return []; },
    getRuns() { return runs; },
  };
}

test('runPlayerEnrichmentPass skips players with existing headshot_url', async () => {
  const participants = createFakeParticipantRepo([
    {
      id: 'p1',
      display_name: 'Already Enriched',
      sport: 'MLB',
      external_id: null,
      metadata: { headshot_url: 'https://example.com/photo.png' },
    },
  ]);
  const runs = createFakeRunsRepo();

  const result = await runPlayerEnrichmentPass({
    participants: participants as unknown as PlayerEnrichmentDeps['participants'],
    runs: runs as unknown as PlayerEnrichmentDeps['runs'],
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.enriched, 0);
  assert.equal(result.failed, 0);

  // system_runs row written
  assert.equal(runs.getRuns().length, 1);
  assert.equal(runs.getRuns()[0]!['run_type'], 'player.enrichment');
});

test('runPlayerEnrichmentPass reports skipped for players with null sport', async () => {
  const participants = createFakeParticipantRepo([
    {
      id: 'p2',
      display_name: 'No Sport Player',
      sport: null,
      external_id: null,
      metadata: { headshot_url: null },
    },
  ]);
  const runs = createFakeRunsRepo();

  const result = await runPlayerEnrichmentPass({
    participants: participants as unknown as PlayerEnrichmentDeps['participants'],
    runs: runs as unknown as PlayerEnrichmentDeps['runs'],
  });

  assert.equal(result.scanned, 1);
  // null sport → resolveHeadshotUrl returns null → skipped
  assert.equal(result.skipped, 1);
  assert.equal(result.enriched, 0);
});

test('runPlayerEnrichmentPass handles empty participant list', async () => {
  const participants = createFakeParticipantRepo([]);
  const runs = createFakeRunsRepo();

  const result = await runPlayerEnrichmentPass({
    participants: participants as unknown as PlayerEnrichmentDeps['participants'],
    runs: runs as unknown as PlayerEnrichmentDeps['runs'],
  });

  assert.equal(result.scanned, 0);
  assert.equal(result.enriched, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
});

test('runPlayerEnrichmentPass writes system_runs record with correct details', async () => {
  const participants = createFakeParticipantRepo([
    {
      id: 'p3',
      display_name: 'Test',
      sport: null,
      external_id: null,
      metadata: { headshot_url: null },
    },
    {
      id: 'p4',
      display_name: 'Enriched',
      sport: 'MLB',
      external_id: null,
      metadata: { headshot_url: 'https://example.com/existing.png' },
    },
  ]);
  const runs = createFakeRunsRepo();

  await runPlayerEnrichmentPass({
    participants: participants as unknown as PlayerEnrichmentDeps['participants'],
    runs: runs as unknown as PlayerEnrichmentDeps['runs'],
  });

  const run = runs.getRuns()[0]!;
  assert.equal(run['run_type'], 'player.enrichment');
  assert.equal(run['status'], 'succeeded');
  const details = run['details'] as Record<string, number>;
  assert.equal(details['scanned'], 2);
  assert.equal(details['skipped'], 2); // one null sport, one already enriched
});

// WORK-2026110205: written before modifying the service; no prepared Codex tests found.
test('NHL unrelated player is refused', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    { playerId: '8484554', name: 'Unrelated Player', teamAbbrev: 'MTL', league: 'NHL' },
  ]));
  assert.equal(await resolveHeadshotUrl('Jake Evans', 'NHL', null), null);
});

test('NHL ambiguous name is refused', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    { playerId: '1', name: 'Jake Evans', teamAbbrev: 'MTL', league: 'NHL' },
    { playerId: '2', name: 'Jake Evans', teamAbbrev: 'MTL', league: 'NHL' },
  ]));
  assert.equal(await resolveHeadshotUrl('Jake Evans', 'NHL', null), null);
});

test('NFL unrelated first result is refused', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [
    { id: '1', displayName: 'Unrelated Player', headshot: 'https://a.espncdn.com/wrong.png' },
  ] }));
  assert.equal(await resolveHeadshotUrl('Josh Allen', 'NFL', null), null);
});

test('all sports require a unique normalized full identity, including symmetric suffixes', async (t) => {
  const { normalizePlayerName, resolveHeadshot } = await import('./player-enrichment-service.js');
  assert.equal(normalizePlayerName('  José  O’Neal, Junior. '), normalizePlayerName('Jose ONeal Jr'));
  assert.notEqual(normalizePlayerName('Gary Trent'), normalizePlayerName('Gary Trent Jr.'));
  assert.equal(normalizePlayerName('Jean-Luc Picard'), normalizePlayerName('Jean Luc Picard'));
  assert.notEqual(normalizePlayerName('Gary Trent II'), normalizePlayerName('Gary Trent III'));
  for (const sport of ['MLB', 'NBA', 'NFL', 'NHL']) {
    const entries = [
      { id: '101', name: 'José O’Neal Junior.' },
      { id: '102', name: 'Gary Trent Jr.' },
      { id: '103', name: 'John Smith' }, { id: '104', name: 'John Smith' },
      { id: '105', name: 'John Smithson' },
      { id: '106', name: 'Robert Jones Senior' }, { id: '107', name: 'Walter Jones II' },
    ];
    t.mock.method(globalThis, 'fetch', async () => Response.json(
      sport === 'MLB' ? { people: entries.map(p => ({ id: Number(p.id), fullName: p.name, currentTeam: { id: 7 } })) } :
      sport === 'NBA' ? { resultSets: [{ headers: ['PERSON_ID', 'DISPLAY_LAST_COMMA_FIRST', 'DISPLAY_FIRST_LAST', 'ROSTERSTATUS', 'FROM_YEAR', 'TO_YEAR', 'PLAYERCODE', 'TEAM_ID', 'TEAM_CITY', 'TEAM_NAME', 'TEAM_ABBREVIATION'], rowSet: entries.map(p => [p.id, p.name, p.name, 1, '', '', '', 7, '', '', 'ABC']) }] } :
      sport === 'NFL' ? { items: entries.map(p => ({ id: p.id, displayName: p.name, team: { id: '7', abbreviation: 'ABC' }, league: 'NFL' })) } :
      entries.map(p => ({ playerId: p.id, name: p.name, teamId: '7', teamAbbrev: 'ABC', league: 'NHL' })),
    ));
    assert.ok((await resolveHeadshotUrl('JOSE ONeal Jr', sport, null))?.includes('101'), sport);
    assert.ok((await resolveHeadshotUrl('José O’Neal Junior.', sport, null))?.includes('101'), sport);
    assert.ok((await resolveHeadshotUrl('Gary Trent Junior', sport, null))?.includes('102'), sport);
    assert.ok((await resolveHeadshotUrl('Robert Jones Sr.', sport, null))?.includes('106'), sport);
    assert.ok((await resolveHeadshotUrl('Walter Jones II', sport, null))?.includes('107'), sport);
    for (const name of ['Gary Trent', 'John', 'Smith', 'Nobody Else', 'Gary Trent Sr.', 'Gary Trent II']) {
      assert.equal(await resolveHeadshotUrl(name, sport, null), null, `${sport}: ${name}`);
    }
    assert.equal((await resolveHeadshot('John Smith', sport)).reason, 'ambiguous', sport);
    assert.equal(await resolveHeadshotUrl('Gary Trent Jr.', sport, null, { teamId: '8' }), null, sport);
    assert.equal(await resolveHeadshotUrl('Gary Trent Jr.', sport, null, { league: 'OTHER' }), null, sport);
    if (sport !== 'MLB') assert.equal(await resolveHeadshotUrl('Gary Trent Jr.', sport, null, { teamAbbrev: 'XYZ' }), null, sport);
    t.mock.restoreAll();
  }
});

test('NFL selects the unique identity after an unrelated first hit and refuses duplicate exact hits', async (t) => {
  let items = [{ id: '1', displayName: 'Unrelated Player' }, { id: '2', displayName: 'Josh Allen' }];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items }));
  assert.match((await resolveHeadshotUrl('Josh Allen', 'NFL', null))!, /\/2\.png/);
  items = [...items, { id: '3', displayName: 'Josh Allen' }];
  assert.equal(await resolveHeadshotUrl('Josh Allen', 'NFL', null), null);
});

test('NHL checks candidate league and team and does not resolve ambiguity using an image', async (t) => {
  let candidates = [{ playerId: '1', name: 'Jake Evans', league: 'AHL', teamAbbrev: 'MTL' }];
  t.mock.method(globalThis, 'fetch', async () => Response.json(candidates));
  assert.equal(await resolveHeadshotUrl('Jake Evans', 'NHL', null), null);
  candidates = [{ playerId: '1', name: 'Jake Evans', league: 'NHL', teamAbbrev: 'MTL' }];
  assert.equal(await resolveHeadshotUrl('Jake Evans', 'NHL', null, { teamAbbrev: 'BOS' }), null);
  assert.match((await resolveHeadshotUrl('Jake Evans', 'NHL', null, { teamAbbrev: 'MTL' }))!, /\/1.jpg$/);
});

test('enrichment records refusal reasons and leaves stored images untouched', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    { playerId: '1', name: 'Jake Evans' }, { playerId: '2', name: 'Jake Evans' },
  ]));
  const participants = createFakeParticipantRepo([
    { id: '1', display_name: 'Jake Evans', sport: 'NHL', metadata: {} },
    { id: '2', display_name: 'Nobody Else', sport: 'NHL', metadata: {} },
    { id: '3', display_name: 'Stored', sport: 'NHL', metadata: { headshot_url: 'stored' } },
  ]);
  const runs = createFakeRunsRepo();
  const result = await runPlayerEnrichmentPass({
    participants: participants as unknown as PlayerEnrichmentDeps['participants'],
    runs: runs as unknown as PlayerEnrichmentDeps['runs'],
  });
  assert.deepEqual(result.refusals, { ambiguous: 1, 'identity-mismatch': 1 });
  assert.deepEqual((runs.getRuns()[0]!['details'] as Record<string, unknown>)['refusals'], result.refusals);
  assert.deepEqual(participants.getStore().get('3')?.['metadata'], { headshot_url: 'stored' });
});

test('NFL checks real ESPN teamRelationships and leagueRelationships identities', async (t) => {
  let item = { id: '3918298', displayName: 'Josh Allen',
    teamRelationships: [{ core: { id: '2', abbreviation: 'BUF' } }],
    leagueRelationships: [{ core: { abbreviation: 'NFL' } }],
  };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [item] }));
  assert.equal(await resolveHeadshotUrl('Josh Allen', 'NFL', null, { teamId: '3' }), null);
  assert.equal(await resolveHeadshotUrl('Josh Allen', 'NFL', null, { teamAbbrev: 'MIA' }), null);
  assert.ok(await resolveHeadshotUrl('Josh Allen', 'NFL', null, { teamId: '2', teamAbbrev: 'BUF' }));
  item = { ...item, leagueRelationships: [{ core: { abbreviation: 'CFL' } }] };
  assert.equal(await resolveHeadshotUrl('Josh Allen', 'NFL', null), null);
});

// Rework regressions: captured before the namespace/header repairs.
test('canonical team keys correlate by full team name and preserve Red Sox versus White Sox', async (t) => {
  const { resolveHeadshot } = await import('./player-enrichment-service.js');
  t.mock.method(Date, 'now', () => 10_000_000_000_000);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ people: [
    { id: 1, fullName: 'Test Player', currentTeam: { id: 145, name: 'Chicago White Sox', teamName: 'White Sox' } },
  ] }));
  assert.equal((await resolveHeadshot('Test Player', 'MLB', { teamId: 'CHICAGO_WHITE_SOX_MLB' })).reason, 'confirmed');
  assert.equal((await resolveHeadshot('Test Player', 'MLB', { teamId: 'BOSTON_RED_SOX_MLB' })).reason, 'identity-mismatch');
  assert.equal((await resolveHeadshot('Test Player', 'MLB', { teamId: 'CHICAGO_CUBS_MLB' })).reason, 'identity-mismatch');
  assert.equal((await resolveHeadshot('Test Player', 'MLB', { teamId: '145' })).reason, 'confirmed');
  assert.equal((await resolveHeadshot('Test Player', 'MLB', { teamId: '111' })).reason, 'identity-mismatch');
});

test('NBA resolves provider columns by headers and correlates LA Clippers with canonical Los Angeles', async (t) => {
  const { resolveHeadshot } = await import('./player-enrichment-service.js');
  let now = 20_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const headers = ['PERSON_ID', 'DISPLAY_LAST_COMMA_FIRST', 'DISPLAY_FIRST_LAST', 'ROSTERSTATUS', 'FROM_YEAR', 'TO_YEAR',
    'PLAYERCODE', 'PLAYER_SLUG', 'TEAM_ID', 'TEAM_CITY', 'TEAM_NAME', 'TEAM_ABBREVIATION'];
  const row = [1, 'Player, Test', 'Test Player', 1, '2020', '2026', 'test', 'test_slug', 1610612746, 'LA', 'Clippers', 'LAC'];
  let reverse = false;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ resultSets: [{
    headers: reverse ? [...headers].reverse() : headers, rowSet: [reverse ? [...row].reverse() : row],
  }] }));
  for (const reorder of [false, true]) {
    reverse = reorder; now += 8_000_000;
    assert.equal((await resolveHeadshot('Test Player', 'NBA', { teamId: 'LOS_ANGELES_CLIPPERS_NBA', teamAbbrev: 'LAC' })).reason, 'confirmed');
    assert.equal((await resolveHeadshot('Test Player', 'NBA', { teamId: '1610612746' })).reason, 'confirmed');
    assert.equal((await resolveHeadshot('Test Player', 'NBA', { teamId: '1610612747' })).reason, 'identity-mismatch');
    assert.equal((await resolveHeadshot('Test Player', 'NBA', { teamId: 'LOS_ANGELES_LAKERS_NBA' })).reason, 'identity-mismatch');
  }
});

test('NHL six Jakes sharing a stored URL never confirms an unrelated Jake', async (t) => {
  const { resolveHeadshot } = await import('./player-enrichment-service.js');
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    { playerId: '8484554', name: 'Jake Johnson', teamId: '5', teamAbbrev: 'PIT' },
    { playerId: '8474100', name: 'Jake Evans', teamId: '8', teamAbbrev: 'MTL' },
  ]));
  for (const name of ['Jake Walman', 'Jake Sanderson', 'Jake Middleton', 'Jake Oettinger', 'Jake Guentzel']) {
    assert.equal((await resolveHeadshot(name, 'NHL')).url, null, name);
  }
  const evans = await resolveHeadshot('Jake Evans', 'NHL', { teamId: 'MONTREAL_CANADIENS_NHL' });
  assert.equal(evans.reason, 'confirmed');
  assert.match(evans.url!, /\/8474100.jpg$/);
  assert.doesNotMatch(evans.url!, /8484554/);
});

// Independent-review regressions: production supplies catalog teamId, no teamAbbrev.
test('NHL production catalog key refuses conflicting provider abbreviation', async (t) => {
  const { resolveHeadshot } = await import('./player-enrichment-service.js');
  t.mock.method(globalThis, 'fetch', async () => Response.json([{ playerId: '1', name: 'Jake Evans', teamId: '5', teamAbbrev: 'PIT' }]));
  assert.equal((await resolveHeadshot('Jake Evans', 'NHL', { teamId: 'MONTREAL_CANADIENS_NHL' })).reason, 'identity-mismatch');
});
test('NHL production catalog key accepts matching provider abbreviation', async (t) => {
  const { resolveHeadshot } = await import('./player-enrichment-service.js');
  t.mock.method(globalThis, 'fetch', async () => Response.json([{ playerId: '1', name: 'Jake Evans', teamId: '8', teamAbbrev: 'MTL' }]));
  assert.equal((await resolveHeadshot('Jake Evans', 'NHL', { teamId: 'MONTREAL_CANADIENS_NHL' })).reason, 'confirmed');
});
test('MLB production catalog key refuses conflicting numeric provider team', async (t) => {
  const { resolveHeadshot } = await import('./player-enrichment-service.js');
  t.mock.method(Date, 'now', () => 30_000_000_000_000);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ people: [{ id: 1, fullName: 'Test Player', currentTeam: { id: 145 } }] }));
  assert.equal((await resolveHeadshot('Test Player', 'MLB', { teamId: 'BOSTON_RED_SOX_MLB' })).reason, 'identity-mismatch');
});
test('MLB production catalog key accepts matching numeric provider team', async (t) => {
  const { resolveHeadshot } = await import('./player-enrichment-service.js');
  t.mock.method(Date, 'now', () => 40_000_000_000_000);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ people: [{ id: 1, fullName: 'Test Player', currentTeam: { id: 145 } }] }));
  assert.equal((await resolveHeadshot('Test Player', 'MLB', { teamId: 'CHICAGO_WHITE_SOX_MLB' })).reason, 'confirmed');
});
test('non-catalog caller team refuses incomparable provider team', async (t) => {
  const { resolveHeadshot } = await import('./player-enrichment-service.js');
  t.mock.method(globalThis, 'fetch', async () => Response.json([{ playerId: '1', name: 'Jake Evans', teamId: '8', teamAbbrev: 'MTL' }]));
  assert.equal((await resolveHeadshot('Jake Evans', 'NHL', { teamId: 'BOS' })).reason, 'identity-mismatch');
});
for (const sport of ['NHL', 'NFL']) {
  test(`${sport} namesake outside old top five is ambiguous`, async (t) => {
    const { resolveHeadshot } = await import('./player-enrichment-service.js');
    t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
      const limit = Number(new URL(String(input)).searchParams.get('limit'));
      const names = ['Jake Evans', 'Unrelated A', 'Unrelated B', 'Unrelated C', 'Unrelated D', 'Jake Evans'];
      return Response.json(sport === 'NHL' ? names.slice(0, limit).map((name, i) => ({ name, playerId: String(i + 1), teamAbbrev: 'MTL' })) :
        { items: names.slice(0, limit).map((displayName, i) => ({ displayName, id: String(i + 1), team: { displayName: 'Montreal Canadiens' } })) });
    });
    assert.equal((await resolveHeadshot('Jake Evans', sport, { teamId: `MONTREAL_CANADIENS_${sport}` })).reason, 'ambiguous');
  });
}
