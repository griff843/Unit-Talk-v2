import assert from 'node:assert/strict';
import test from 'node:test';
import { readPicksExplorerQuery, picksExplorerHref, PICK_STATUS_OPTIONS } from './picks-explorer-query';

test('explorer bounds invalid paging and uses canonical lifecycle options', () => {
  for (const page of ['NaN', 'Infinity', '-3', '2.5', '0']) {
    assert.equal(readPicksExplorerQuery({ page, limit: 'Infinity' }).page, 1);
    assert.equal(readPicksExplorerQuery({ page, limit: 'Infinity' }).limit, 25);
  }
  assert.equal(readPicksExplorerQuery({ page: '9999999999' }).page, 1_000_000);
  assert.equal(readPicksExplorerQuery({ page: ['2', '3'], status: 'invented' }).status, '');
  assert.ok(PICK_STATUS_OPTIONS.includes('awaiting_approval'));
  assert.equal(PICK_STATUS_OPTIONS.includes('failed'), false);
});

test('distribution mode is allow-listed and page links preserve it across navigation', () => {
  assert.equal(readPicksExplorerQuery({ distributionMode: 'track-only' }).distributionMode, 'track-only');
  assert.equal(readPicksExplorerQuery({ distributionMode: 'delivery-eligible' }).distributionMode, 'delivery-eligible');
  assert.equal(readPicksExplorerQuery({ distributionMode: 'ungoverned' }).distributionMode, 'ungoverned');
  assert.equal(readPicksExplorerQuery({ distributionMode: 'invented' }).distributionMode, '');

  const query = readPicksExplorerQuery({ q: '  Lions & Chiefs  ', status: 'posted', distributionMode: 'delivery-eligible', limit: '5', population: 'fixtures' });
  const next = new URL(picksExplorerHref(query, 2), 'http://localhost');
  assert.equal(next.searchParams.get('q'), 'Lions & Chiefs');
  assert.equal(next.searchParams.get('status'), 'posted');
  assert.equal(next.searchParams.get('distributionMode'), 'delivery-eligible');
  assert.equal(next.searchParams.get('limit'), '5');
  assert.equal(next.searchParams.get('page'), '2');
  assert.equal(next.searchParams.get('population'), 'fixtures');
  assert.equal(readPicksExplorerQuery(Object.fromEntries(next.searchParams)).page, 2);
});

test('parses and preserves capper, sport, date and ID-prefix search state', () => {
  const query = readPicksExplorerQuery({ q: 'abcdef', capper: 'kingro623', sport: 'NBA', dateFrom: '2026-10-01', dateTo: '2026-10-28' });
  assert.deepEqual({ q: query.q, capper: query.capper, sport: query.sport, dateFrom: query.dateFrom, dateTo: query.dateTo }, { q: 'abcdef', capper: 'kingro623', sport: 'NBA', dateFrom: '2026-10-01', dateTo: '2026-10-28' });
  const href = new URL(picksExplorerHref(query, 2), 'http://localhost');
  assert.equal(href.searchParams.get('capper'), 'kingro623');
  assert.equal(href.searchParams.get('dateTo'), '2026-10-28');
});

test('result filter is validated and preserved across pages', () => {
  assert.equal(readPicksExplorerQuery({ result: 'invalid' }).result, '');
  for (const result of ['win', 'loss', 'push', 'void', 'pending']) {
    const query = readPicksExplorerQuery({ result, capper: 'kingro623' });
    assert.equal(new URL(picksExplorerHref(query, 2), 'http://localhost').searchParams.get('result'), result);
  }
});
