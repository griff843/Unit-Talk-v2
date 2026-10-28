import test from 'node:test';
import assert from 'node:assert/strict';
import { canSubmitSettlementScoreCheck, checkSettlementScore } from './settlement-score-check.js';

const score = (input: Partial<Parameters<typeof checkSettlementScore>[0]>) =>
  checkSettlementScore({ market: 'moneyline', selection: 'Ducks', line: 0, awayScore: 3, homeScore: 2, ...input });

test('moneyline resolves both sides and a push', () => {
  assert.deepEqual(score({ side: 'away' }), { result: 'win' });
  assert.deepEqual(score({ side: 'home' }), { result: 'loss' });
  assert.deepEqual(score({ side: 'home', awayScore: 2, homeScore: 2 }), { result: 'push' });
});

test('spread resolves both sides and a push', () => {
  assert.deepEqual(score({ market: 'spread', side: 'away', line: -3.5, awayScore: 27, homeScore: 20 }), { result: 'win' });
  assert.deepEqual(score({ market: 'spread', side: 'home', line: 3.5, awayScore: 27, homeScore: 20 }), { result: 'loss' });
  assert.deepEqual(score({ market: 'spread', side: 'away', line: -4, awayScore: 24, homeScore: 20 }), { result: 'push' });
});

test('game total resolves over and under, including the real loss fixture', () => {
  assert.deepEqual(score({ market: 'game total', selection: 'Over', line: 6.5, awayScore: 1, homeScore: 3 }), { result: 'loss' });
  assert.deepEqual(score({ market: 'total', selection: 'Under', line: 6.5, awayScore: 1, homeScore: 3 }), { result: 'win' });
  assert.deepEqual(score({ market: 'game total', selection: 'Over', line: 6.5, awayScore: 3, homeScore: 3.5 }), { result: 'push' });
});

test('team total resolves the named away and home team, including the real fixture', () => {
  const base = { market: 'team total', line: 3.5, eventName: 'Ducks @ Canucks', selection: 'Ducks Over' };
  assert.deepEqual(score({ ...base, side: 'away', awayScore: 5, homeScore: 6 }), { result: 'win' });
  assert.deepEqual(score({ market: 'team total', line: 3.5, eventName: 'Canucks @ Ducks', selection: 'Ducks Over', awayScore: 6, homeScore: 5 }), { result: 'win' });
});

test('unsupported or ambiguous markets fail closed', () => {
  assert.equal(score({ market: 'player points', selection: 'Player Over 20.5' }).result, 'unsupported');
  assert.equal(score({ market: 'team total', selection: 'Over', eventName: 'Ducks @ Canucks' }).result, 'unsupported');
});

test('a mismatched operator choice is blocked until an override reason is entered', () => {
  const check = { result: 'loss' as const };
  assert.equal(canSubmitSettlementScoreCheck('win', check, ''), false);
  assert.equal(canSubmitSettlementScoreCheck('win', check, 'Official correction pending'), true);
  assert.equal(canSubmitSettlementScoreCheck('loss', check, ''), true);
});
