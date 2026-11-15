import test from 'node:test';
import assert from 'node:assert/strict';
import { canSubmitSettlementScoreCheck, checkSettlementScore, settlementEventTeams, supportsSettlementScoreMarket } from './settlement-score-check.js';

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

test('production pick shapes: Smart Form market keys, O/U selections and string lines', () => {
  // fa5e1dd2: Ducks team total over 3.5, Canucks @ Ducks, final Canucks 6 Ducks 5
  assert.deepEqual(
    checkSettlementScore({ market: 'team_total_ou', selection: 'Ducks Over 3.5', line: '3.50', eventName: 'Canucks @ Ducks', awayScore: 6, homeScore: 5 }),
    { result: 'win' },
  );
  // game total over 6.5, Kings 1 Devils 3
  assert.deepEqual(
    checkSettlementScore({ market: 'game_total_ou', selection: 'O 6.5', line: '6.50', eventName: 'Kings @ Devils', awayScore: 1, homeScore: 3 }),
    { result: 'loss' },
  );
  assert.deepEqual(
    checkSettlementScore({ market: 'game_total_ou', selection: 'U 6.5', line: '6.50', awayScore: 1, homeScore: 3 }),
    { result: 'win' },
  );
  assert.deepEqual(
    checkSettlementScore({ market: 'spread', selection: 'Chiefs -2.5', line: '-2.50', eventName: 'Chiefs @ Bills', awayScore: 27, homeScore: 24 }),
    { result: 'win' },
  );
  assert.deepEqual(
    checkSettlementScore({ market: 'moneyline', selection: 'Bills', line: null, eventName: 'Chiefs @ Bills', awayScore: 27, homeScore: 24 }),
    { result: 'loss' },
  );
});

test('period markets, "vs" event names and unparseable lines fail closed', () => {
  for (const market of ['1h_spread', '1q_total_ou', '2h_moneyline', 'player_points_ou']) {
    assert.equal(supportsSettlementScoreMarket(market), false, market);
  }
  assert.equal(settlementEventTeams('Chiefs vs Bills'), null);
  assert.deepEqual(settlementEventTeams('Chiefs @ Bills'), ['Chiefs', 'Bills']);
  assert.equal(
    checkSettlementScore({ market: 'moneyline', selection: 'Bills', line: null, eventName: 'Chiefs vs Bills', awayScore: 27, homeScore: 24 }).result,
    'unsupported',
  );
  assert.equal(
    checkSettlementScore({ market: 'game_total_ou', selection: 'O 6.5', line: 'n/a', awayScore: 1, homeScore: 3 }).result,
    'unsupported',
  );
});

test('an undecidable check never blocks submission', () => {
  assert.equal(canSubmitSettlementScoreCheck('win', { result: 'unsupported', reason: 'x' }, ''), true);
  assert.equal(canSubmitSettlementScoreCheck('void', { result: 'loss' }, ''), true);
});
