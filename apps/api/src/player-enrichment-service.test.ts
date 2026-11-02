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
    ];
    t.mock.method(globalThis, 'fetch', async () => Response.json(
      sport === 'MLB' ? { people: entries.map(p => ({ id: Number(p.id), fullName: p.name, currentTeam: { id: 7 } })) } :
      sport === 'NBA' ? { resultSets: [{ rowSet: entries.map(p => [p.id, p.name, p.name, 1, '', '', '', 7, '', '', 'ABC']) }] } :
      sport === 'NFL' ? { items: entries.map(p => ({ id: p.id, displayName: p.name, team: { id: '7', abbreviation: 'ABC' }, league: 'NFL' })) } :
      entries.map(p => ({ playerId: p.id, name: p.name, teamId: '7', teamAbbrev: 'ABC', league: 'NHL' })),
    ));
    assert.ok((await resolveHeadshotUrl('JOSE ONeal Jr', sport, null))?.includes('101'), sport);
    assert.ok((await resolveHeadshotUrl('José O’Neal Junior.', sport, null))?.includes('101'), sport);
    assert.ok((await resolveHeadshotUrl('Gary Trent Junior', sport, null))?.includes('102'), sport);
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
