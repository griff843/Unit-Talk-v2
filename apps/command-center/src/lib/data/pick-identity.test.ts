import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveSettlementLabel, effectiveSettlementTimestamp, mapPickIdentityRead } from './pick-identity.js';

const pick = { id: 'pick-1', source: 'smart-form', market: 'spread', selection: 'Chiefs -2.5', line: -2.5, odds: -110, stake_units: 2, created_at: '2026-10-28T12:00:00Z', status: 'posted', metadata: { eventName: 'Chiefs at Bills', sport: 'NFL', capper: 'kingro623' }, capper_id: 'kingro623', capper_display_name: 'kingro623' };

test('WORK-2026103020: Track Only displays effective settlement time while lifecycle timestamp stays null', () => {
  const row = { ...pick, status: 'validated', settled_at: null };
  const identity = mapPickIdentityRead(row, [{ id: 'settlement', status: 'settled', result: 'win',
    settled_at: '2026-10-30T00:18:51Z', created_at: '2026-10-30T00:18:51Z' }]);
  assert.equal(effectiveSettlementTimestamp(identity.settlement), '2026-10-30T00:18:51Z');
  assert.equal(row.status, 'validated');
  assert.equal(row.settled_at, null);
});

test('WORK-2026103020: older correction time wins over its newer parent and stale lifecycle time', () => {
  const identity = mapPickIdentityRead({ ...pick, settled_at: '2026-10-30T14:00:00Z' }, [
    { id: 'original', status: 'settled', result: 'loss', settled_at: '2026-10-30T13:00:00Z', created_at: '2026-10-30T13:00:00Z' },
    { id: 'correction', corrects_id: 'original', status: 'settled', result: 'win', settled_at: '2026-10-30T12:00:00Z', created_at: '2026-10-30T12:00:00Z' },
  ]);
  assert.equal(effectiveSettlementTimestamp(identity.settlement), '2026-10-30T12:00:00Z');
});

test('WORK-2026103020: pending, manual review and missing/invalid effective times never fall back to the lifecycle time', () => {
  const row = { ...pick, settled_at: '2026-10-30T14:00:00Z' };
  assert.equal(effectiveSettlementTimestamp(mapPickIdentityRead(row, []).settlement), null);
  for (const status of ['manual_review', 'pending']) {
    const identity = mapPickIdentityRead(row, [{ id: 'original', status: 'settled', result: 'win', settled_at: '2026-10-30T13:00:00Z' },
      { id: 'current', corrects_id: 'original', status, result: 'win', settled_at: '2026-10-30T12:00:00Z' }]);
    assert.equal(effectiveSettlementTimestamp(identity.settlement), null);
  }
  for (const settled_at of [null, '', 'invalid-time']) {
    const identity = mapPickIdentityRead(row, [{ id: 'current', status: 'settled', result: 'win', settled_at }]);
    assert.equal(effectiveSettlementTimestamp(identity.settlement), null);
  }
});

test('maps a pick with no settlement to a truthful pending target', () => {
  const result = mapPickIdentityRead(pick, []);
  assert.equal(result.identity.capper, 'kingro623');
  assert.equal(result.identity.matchup, 'Chiefs at Bills');
  assert.equal(result.settlement, null);
});

test('maps the latest correction as the current effective settlement', () => {
  const result = mapPickIdentityRead(pick, [
    { id: 'settlement-2', status: 'settled', result: 'loss', source: 'operator', settled_at: '2026-10-28T13:00:00Z', corrects_id: 'settlement-1', created_at: '2026-10-28T12:00:00Z', payload: {} },
    { id: 'settlement-1', status: 'settled', result: 'win', source: 'operator', settled_at: '2026-10-28T12:30:00Z', corrects_id: null, created_at: '2026-10-28T12:30:00Z', payload: {} },
  ]);
  assert.equal(result.settlement?.result, 'loss');
  assert.equal(result.settlement?.correctsId, 'settlement-1');
  assert.equal(effectiveSettlementLabel(result.settlement, true), 'loss (corrected)');
});

test('does not label unavailable settlement history as pending', () => {
  assert.equal(effectiveSettlementLabel(null, true), 'Settlement history unavailable');
  assert.equal(effectiveSettlementLabel(null, false), 'Pending settlement');
});

test('refuses an incomplete correction chain', () => {
  assert.throws(() => mapPickIdentityRead(pick, [{ id: 'correction', corrects_id: 'missing', result: 'win' }]), /incomplete/);
});

test('does not attribute a pick from metadata when canonical capper_id is absent', () => {
  assert.equal(mapPickIdentityRead({ ...pick, capper_id: null }, []).identity.capper, null);
});

test('coerces numeric columns that PostgREST returns as strings', () => {
  const result = mapPickIdentityRead({ ...pick, line: '-2.5', odds: '-110', stake_units: '3.50' }, []);
  assert.equal(result.line, -2.5);
  assert.equal(result.odds, -110);
  assert.equal(result.stakeUnits, 3.5);
  assert.equal(mapPickIdentityRead({ ...pick, line: '', odds: 'n/a', stake_units: null }, []).odds, null);
});
