import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTeamLogoUrl, runTeamLogoEnrichmentPass, type TeamLogoEnrichmentDeps } from './team-logo-enrichment-service.js';

// ── resolveTeamLogoUrl ────────────────────────────────────────────

test('resolveTeamLogoUrl returns null for null abbreviation', async () => {
  const result = await resolveTeamLogoUrl(null, 'NBA');
  assert.equal(result, null);
});

test('resolveTeamLogoUrl returns null for null sport', async () => {
  const result = await resolveTeamLogoUrl('NYK', null);
  assert.equal(result, null);
});

test('resolveTeamLogoUrl returns null for unsupported sport', async () => {
  const result = await resolveTeamLogoUrl('ABC', 'CRICKET');
  assert.equal(result, null);
});

// ── runTeamLogoEnrichmentPass ─────────────────────────────────────

function createFakeParticipantRepo(teams: Array<Record<string, unknown>>) {
  const store = new Map<string, Record<string, unknown>>();
  for (const t of teams) store.set(t['id'] as string, { ...t });

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

test('runTeamLogoEnrichmentPass skips teams with existing logo_url', async () => {
  const participants = createFakeParticipantRepo([
    {
      id: 't1',
      display_name: 'New York Knicks',
      sport: 'NBA',
      external_id: null,
      metadata: { logo_url: 'https://example.com/logo.png', abbreviation: 'NYK' },
    },
  ]);
  const runs = createFakeRunsRepo();

  const result = await runTeamLogoEnrichmentPass({
    participants: participants as unknown as TeamLogoEnrichmentDeps['participants'],
    runs: runs as unknown as TeamLogoEnrichmentDeps['runs'],
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.enriched, 0);
  assert.equal(result.failed, 0);

  assert.equal(runs.getRuns().length, 1);
  assert.equal(runs.getRuns()[0]!['run_type'], 'team.logo.enrichment');
});

test('runTeamLogoEnrichmentPass skips teams with null abbreviation', async () => {
  const participants = createFakeParticipantRepo([
    {
      id: 't2',
      display_name: 'Unknown Team',
      sport: 'NBA',
      external_id: null,
      metadata: { logo_url: null, abbreviation: null },
    },
  ]);
  const runs = createFakeRunsRepo();

  const result = await runTeamLogoEnrichmentPass({
    participants: participants as unknown as TeamLogoEnrichmentDeps['participants'],
    runs: runs as unknown as TeamLogoEnrichmentDeps['runs'],
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.enriched, 0);
});

test('runTeamLogoEnrichmentPass handles empty team list', async () => {
  const participants = createFakeParticipantRepo([]);
  const runs = createFakeRunsRepo();

  const result = await runTeamLogoEnrichmentPass({
    participants: participants as unknown as TeamLogoEnrichmentDeps['participants'],
    runs: runs as unknown as TeamLogoEnrichmentDeps['runs'],
  });

  assert.equal(result.scanned, 0);
  assert.equal(result.enriched, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
});

test('runTeamLogoEnrichmentPass writes system_runs record', async () => {
  const participants = createFakeParticipantRepo([
    {
      id: 't3',
      display_name: 'Test Team',
      sport: null,
      external_id: null,
      metadata: { logo_url: null, abbreviation: 'TST' },
    },
  ]);
  const runs = createFakeRunsRepo();

  await runTeamLogoEnrichmentPass({
    participants: participants as unknown as TeamLogoEnrichmentDeps['participants'],
    runs: runs as unknown as TeamLogoEnrichmentDeps['runs'],
  });

  const run = runs.getRuns()[0]!;
  assert.equal(run['run_type'], 'team.logo.enrichment');
  assert.equal(run['status'], 'succeeded');
});
