import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPickIdentityRead } from './pick-identity.js';

const pick = { id: 'pick-1', source: 'smart-form', market: 'spread', selection: 'Chiefs -2.5', line: -2.5, odds: -110, stake_units: 2, created_at: '2026-10-28T12:00:00Z', status: 'posted', metadata: { eventName: 'Chiefs at Bills', sport: 'NFL', capper: 'kingro623' }, capper_display_name: 'kingro623' };

test('maps a pick with no settlement to a truthful pending target', () => {
  const result = mapPickIdentityRead(pick, []);
  assert.equal(result.identity.capper, 'kingro623');
  assert.equal(result.identity.matchup, 'Chiefs at Bills');
  assert.equal(result.settlement, null);
});

test('maps the latest correction as the current effective settlement', () => {
  const result = mapPickIdentityRead(pick, [
    { result: 'loss', source: 'operator', settled_at: '2026-10-28T13:00:00Z', corrects_id: 'settlement-1', created_at: '2026-10-28T13:00:00Z', payload: {} },
    { result: 'win', source: 'operator', settled_at: '2026-10-28T12:30:00Z', corrects_id: null, created_at: '2026-10-28T12:30:00Z', payload: {} },
  ]);
  assert.equal(result.settlement?.result, 'loss');
  assert.equal(result.settlement?.correctsId, 'settlement-1');
});

test('coerces numeric columns that PostgREST returns as strings', () => {
  const result = mapPickIdentityRead({ ...pick, line: '-2.5', odds: '-110', stake_units: '3.50' }, []);
  assert.equal(result.line, -2.5);
  assert.equal(result.odds, -110);
  assert.equal(result.stakeUnits, 3.5);
  assert.equal(mapPickIdentityRead({ ...pick, line: '', odds: 'n/a', stake_units: null }, []).odds, null);
});
