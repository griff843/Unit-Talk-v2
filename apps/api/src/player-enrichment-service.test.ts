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
