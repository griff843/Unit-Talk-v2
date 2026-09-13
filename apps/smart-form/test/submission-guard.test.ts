import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionPickKey, createSessionSubmissionGuard, type PickIdentity } from '../lib/submission-guard';
const base: PickIdentity = { capper: 'griff843', gameDate: '2026-09-13', sport: 'NFL', event: 'Chiefs @ Bills', market: 'total', direction: 'over', line: 44.5, odds: -110, sportsbook: 'fanatics' };
test('case and repeated whitespace normalize; tuple encoding prevents delimiter collisions', () => {
  assert.equal(buildSessionPickKey(base), buildSessionPickKey({ ...base, event: ' CHIEFS   @ Bills ', capper: ' GRIFF843 ' }));
  assert.notEqual(buildSessionPickKey({ ...base, event: 'a|b', market: 'c' }), buildSessionPickKey({ ...base, event: 'a', market: 'b|c' }));
});
test('different capper/date/sport/event/market/player/stat/team/direction/line/price/book are distinct', () => {
  const variants: Partial<PickIdentity>[] = [{ capper: 'other' }, { gameDate: '2026-09-14' }, { sport: 'NCAAF' }, { event: 'Bills @ Chiefs' }, { market: 'spread' }, { player: 'Player A' }, { stat: 'Passing Yards' }, { team: 'Chiefs' }, { direction: 'under' }, { line: 45.5 }, { odds: 105 }, { sportsbook: 'draftkings' }];
  for (const change of variants) assert.notEqual(buildSessionPickKey(base), buildSessionPickKey({ ...base, ...change }), JSON.stringify(change));
  assert.notEqual(buildSessionPickKey({ ...base, line: 0 }), buildSessionPickKey({ ...base, line: undefined }));
});
test('a synchronous lock refuses all concurrent submits; failure releases for retry', () => {
  const guard = createSessionSubmissionGuard();
  assert.equal(guard.acquire('a'), 'acquired');
  assert.equal(guard.acquire('a'), 'in-flight');
  assert.equal(guard.acquire('b'), 'in-flight');
  guard.release('unrelated');
  assert.equal(guard.acquire('b'), 'in-flight');
  guard.release('a');
  assert.equal(guard.acquire('a'), 'acquired');
  guard.markSaved('a');
  guard.release('a');
  assert.equal(guard.acquire('a'), 'already-saved');
  assert.equal(guard.acquire('b'), 'acquired');
});
test('success survives component remount through storage, failure never persists', () => {
  let value: string | null = null;
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
  const first = createSessionSubmissionGuard(() => storage);
  first.acquire('failed'); first.release('failed');
  first.acquire('saved'); first.markSaved('saved'); first.release('saved');
  const second = createSessionSubmissionGuard(() => storage);
  assert.equal(second.acquire('saved'), 'already-saved');
  assert.equal(second.acquire('failed'), 'acquired');
});
test('malformed or wrongly shaped storage cannot crash submission', () => {
  for (const value of ['{', '{}', '[1]', 'null']) {
    const guard = createSessionSubmissionGuard(() => ({ getItem: () => value, setItem: () => {} }));
    assert.equal(guard.acquire('a'), 'acquired'); guard.markSaved('a'); guard.release('a');
    assert.equal(guard.acquire('a'), 'already-saved');
  }
});
test('denied storage access and quota failures retain the in-memory successful guard', () => {
  const denied = createSessionSubmissionGuard(() => { throw new Error('denied'); });
  assert.equal(denied.acquire('a'), 'acquired'); denied.markSaved('a'); denied.release('a');
  assert.equal(denied.acquire('a'), 'already-saved');
  const quota = createSessionSubmissionGuard(() => ({ getItem: () => null, setItem: () => { throw new Error('quota'); } }));
  assert.equal(quota.acquire('a'), 'acquired'); quota.markSaved('a'); quota.release('a');
  assert.equal(quota.acquire('a'), 'already-saved');
});
test('stale/unacquired success does not poison a future ticket', () => {
  const guard = createSessionSubmissionGuard(); guard.markSaved('a');
  assert.equal(guard.acquire('a'), 'acquired');
});
