import assert from 'node:assert/strict';
import test from 'node:test';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

test('track-only awaiting settlement uses the governed predicate, count, and oldest-first ordering', async () => {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const oldToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'track-only-reader-test';
  const { getResultsOpsSnapshot } = await import('./results-ops');
  const originalFetch = globalThis.fetch;
  const trackOnlyFixtures = [
    {
      id: 'track-new', capper_id: 'kingro623', capper_display_name: 'Kingro623',
      metadata: { distributionMode: 'track-only', eventName: 'New Event' }, status: 'queued',
      settlement_recorded_at: null, created_at: '2026-10-28T12:00:00.000Z',
      sport_display_name: 'NBA', market: 'spread', selection: 'Away', line: 2.5, odds: -110, stake_units: 1,
    },
    {
      id: 'track-old', capper_id: 'griff843', capper_display_name: 'Griff843',
      metadata: { distributionMode: 'track-only', eventName: 'Old Event' }, status: 'queued',
      settlement_recorded_at: null, created_at: '2026-10-28T10:00:00.000Z',
      sport_display_name: 'MLB', market: 'moneyline', selection: 'Home', line: null, odds: 125, stake_units: 2,
    },
    {
      id: 'track-settled', capper_id: 'griff843', capper_display_name: 'Griff843',
      metadata: { distributionMode: 'track-only', eventName: 'Settled Event' }, status: 'queued',
      settlement_recorded_at: '2026-10-28T09:00:00.000Z', created_at: '2026-10-28T09:00:00.000Z',
    },
    {
      id: 'track-voided', capper_id: 'kingro623', capper_display_name: 'Kingro623',
      metadata: { distributionMode: 'track-only', eventName: 'Voided Event' }, status: 'voided',
      settlement_recorded_at: null, created_at: '2026-10-28T08:00:00.000Z',
    },
    {
      id: 'delivered-authorized', capper_id: 'griff843', capper_display_name: 'Griff843',
      metadata: { distributionMode: 'delivered', eventName: 'Delivered Event', deliveryAuthorization: { decision: 'authorized' } },
      status: 'posted', settlement_recorded_at: null, created_at: '2026-10-28T07:00:00.000Z',
    },
  ];

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const table = url.pathname.split('/').at(-1);
    const head = request.method === 'HEAD';
    if (table === 'settlement_records') {
      return Response.json([], { headers: { 'content-range': '*/0' } });
    }
    if (table === 'game_results') {
      return head
        ? new Response(null, { headers: { 'content-range': '*/0' } })
        : Response.json([]);
    }
    if (table !== 'picks_current_state') throw new Error(`Unexpected table ${table}`);

    const isTrackOnly = url.searchParams.get('metadata->>distributionMode') === 'eq.track-only';
    if (isTrackOnly) {
      assert.equal(url.searchParams.get('settlement_recorded_at'), 'is.null');
      assert.equal(url.searchParams.get('status'), 'neq.voided');
      if (head) return new Response(null, { headers: { 'content-range': '*/2' } });
      assert.equal(url.searchParams.get('order'), 'created_at.asc');
      const rows = trackOnlyFixtures
        .filter((row) => row.metadata.distributionMode === 'track-only')
        .filter((row) => row.settlement_recorded_at === null)
        .filter((row) => row.status !== 'voided')
        .sort((left, right) => left.created_at.localeCompare(right.created_at));
      assert.equal(url.searchParams.get('limit'), '50');
      return Response.json(rows);
    }
    if (head) return new Response(null, { headers: { 'content-range': '*/0' } });
    return Response.json([]);
  };

  try {
    const snapshot = await withRequestContext(
      { authorization: 'Bearer track-only-reader-test' },
      () => getResultsOpsSnapshot(),
    );
    assert.equal(snapshot.counts.trackOnlyAwaitingSettlement, 2);
    assert.deepEqual(snapshot.trackOnlyAwaitingSettlement.map((row) => row.id), ['track-old', 'track-new']);
    assert.equal(snapshot.trackOnlyAwaitingSettlement[0]?.capperDisplayName, 'Griff843');
    assert.equal(snapshot.trackOnlyAwaitingSettlement[0]?.eventName, 'Old Event');
    assert.equal(snapshot.trackOnlyAwaitingSettlement.some((row) => row.id === 'track-settled'), false);
    assert.equal(snapshot.trackOnlyAwaitingSettlement.some((row) => row.id === 'track-voided'), false);
    assert.equal(snapshot.trackOnlyAwaitingSettlement.some((row) => row.id === 'delivered-authorized'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = oldToken;
    restoreTarget();
    restoreDefaults();
  }
});
