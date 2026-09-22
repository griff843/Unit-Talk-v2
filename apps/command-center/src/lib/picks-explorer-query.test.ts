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

test('page links preserve search, lifecycle and population across navigation', () => {
  const query = readPicksExplorerQuery({ q: '  Lions & Chiefs  ', status: 'posted', limit: '5', population: 'fixtures' });
  const next = new URL(picksExplorerHref(query, 2), 'http://localhost');
  assert.equal(next.searchParams.get('q'), 'Lions & Chiefs');
  assert.equal(next.searchParams.get('status'), 'posted');
  assert.equal(next.searchParams.get('limit'), '5');
  assert.equal(next.searchParams.get('page'), '2');
  assert.equal(next.searchParams.get('population'), 'fixtures');
  assert.equal(readPicksExplorerQuery(Object.fromEntries(next.searchParams)).page, 2);
});
