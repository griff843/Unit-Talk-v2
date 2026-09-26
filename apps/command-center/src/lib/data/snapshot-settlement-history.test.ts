import assert from 'node:assert/strict';
import test from 'node:test';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

type Row = Record<string, unknown>;

function settlement(overrides: Row): Row {
  return {
    id: 'root-1', pick_id: 'pick-1', status: 'settled', result: 'win', confidence: 'confirmed',
    corrects_id: null, settled_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z',
    source: 'operator', payload: {}, ...overrides,
  };
}

/**
 * Serves a created_at window and, separately, the by-pick history read. The window is
 * what a truncating `.limit()` returns; `history` is every row the table holds.
 */
async function withStubbedSupabase<T>(
  tables: { window: Row[]; history: Row[]; picks?: Row[] },
  run: () => Promise<T>,
): Promise<{ value: T; historyReads: string[] }> {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'snapshot-history-test';
  const originalFetch = globalThis.fetch;
  const historyReads: string[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const range = { 'content-range': '*/0' };
    if (url.pathname === '/rest/v1/settlement_records') {
      const pickFilter = url.searchParams.get('pick_id');
      if (pickFilter) {
        historyReads.push(pickFilter);
        const ids = pickFilter.replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map((id) => id.replace(/"/g, ''));
        return Response.json(tables.history.filter((row) => ids.includes(String(row['pick_id']))));
      }
      return Response.json(tables.window);
    }
    if (url.pathname === '/rest/v1/picks') {
      if (request.method === 'HEAD' || url.searchParams.get('select') === 'id') return new Response(null, { headers: range });
      return Response.json(tables.picks ?? []);
    }
    throw new Error(`unexpected request ${url.pathname}`);
  };
  try {
    const value = await withRequestContext({ authorization: 'Bearer snapshot-history-test' }, run);
    return { value, historyReads };
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN; else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget(); restoreDefaults();
  }
}

const root = settlement({ id: 'root-1', result: 'win' });
const correction = settlement({ id: 'fix-2', result: 'loss', corrects_id: 'root-1', created_at: '2026-09-20T00:00:00Z' });
const secondCorrection = settlement({ id: 'fix-3', result: 'push', corrects_id: 'fix-2', created_at: '2026-09-21T00:00:00Z' });

test('recap counts a chain whose root fell outside the window, with the tip result', async () => {
  const { getRecapData } = await import('./snapshot');
  const { value, historyReads } = await withStubbedSupabase(
    { window: [secondCorrection, correction], history: [root, correction, secondCorrection] },
    () => getRecapData(),
  );
  assert.equal(historyReads.length, 1);
  assert.equal(value.data.total_picks, 1);
  assert.equal(value.data.by_result['push'], 1);
  assert.equal(value.data.correction_count, 1);
  assert.equal((value.data.by_result['win'] ?? 0) + (value.data.by_result['loss'] ?? 0), 0);
});

test('recap does not count a lone correction whose target cannot be read', async () => {
  const { getRecapData } = await import('./snapshot');
  const { value } = await withStubbedSupabase(
    { window: [correction], history: [correction] },
    () => getRecapData(),
  );
  assert.equal(value.data.total_picks, 0);
});

test('recap excludes an orphan correction rather than reporting the superseded root', async () => {
  const { getRecapData } = await import('./snapshot');
  const orphan = settlement({ id: 'fix-3', result: 'loss', corrects_id: 'missing-row', created_at: '2026-09-21T00:00:00Z' });
  const { value } = await withStubbedSupabase(
    { window: [orphan, root], history: [root, orphan] },
    () => getRecapData(),
  );
  assert.equal(value.data.total_picks, 0);
  assert.equal(value.data.by_result['win'] ?? 0, 0);
});

test('pipeline shows a recent pick settled outside the settlement window with its effective result', async () => {
  const { getPicksPipelineData } = await import('./snapshot');
  const pick = { id: 'pick-1', status: 'settled', metadata: {}, created_at: '2026-09-22T00:00:00Z' };
  const { value } = await withStubbedSupabase(
    { window: [], history: [root, correction], picks: [pick] },
    () => getPicksPipelineData(),
  );
  const data = (value as { data: { recentPicks: Array<{ id: string; settlementResult: string | null }> } }).data;
  assert.equal(data.recentPicks[0]?.settlementResult, 'loss');
});

test('recap excludes a branched chain -- two corrections of one record -- instead of picking a branch', async () => {
  const { getRecapData } = await import('./snapshot');
  const rival = settlement({ id: 'fix-2b', result: 'win', corrects_id: 'root-1', created_at: '2026-09-20T01:00:00Z' });
  const { value } = await withStubbedSupabase(
    { window: [rival, correction], history: [root, correction, rival] },
    () => getRecapData(),
  );
  assert.equal(value.data.total_picks, 0);
});
