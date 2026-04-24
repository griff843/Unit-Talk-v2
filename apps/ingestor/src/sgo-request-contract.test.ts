import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferSgoParticipantId,
  normalizeSgoProviderMarketKey,
  parseSgoOddId,
  stripSgoSideSuffix,
} from './sgo-request-contract.js';

/*
 * SGO contract regression suite.
 *
 * Before a new SGO market family is treated as supported, add one fixture here
 * that proves the provider oddID shape, normalized market key, participant
 * expectation, and supported/deferred decision. Then add the downstream
 * materializer/grading fixture that consumes that normalized family.
 */

test('SGO oddID contract normalizes representative supported market families', () => {
  const cases = [
    {
      name: 'game total',
      oddId: 'points-all-game-ou-over',
      normalizedMarketKey: 'points-all-game-ou',
      statEntityKind: 'all',
      participantId: null,
      sideId: 'over',
    },
    {
      name: 'moneyline',
      oddId: 'moneyline-home-game-ml-home',
      normalizedMarketKey: 'moneyline-all-game-ml',
      statEntityKind: 'team',
      participantId: null,
      sideId: 'home',
    },
    {
      name: 'spread',
      oddId: 'points-away-game-spread-away',
      normalizedMarketKey: 'points-all-game-spread',
      statEntityKind: 'team',
      participantId: null,
      sideId: 'away',
    },
    {
      name: 'player prop',
      oddId: 'points-player-LEBRON_JAMES_2544_NBA-game-ou-over',
      normalizedMarketKey: 'points-all-game-ou',
      statEntityKind: 'player',
      participantId: 'LEBRON_JAMES_2544_NBA',
      sideId: 'over',
    },
  ] as const;

  for (const scenario of cases) {
    const parsed = parseSgoOddId(scenario.oddId);

    assert.ok(parsed, scenario.name);
    assert.equal(parsed.supported, true, scenario.name);
    assert.equal(parsed.normalizedMarketKey, scenario.normalizedMarketKey, scenario.name);
    assert.equal(parsed.statEntityKind, scenario.statEntityKind, scenario.name);
    assert.equal(parsed.sideId, scenario.sideId, scenario.name);
    assert.equal(normalizeSgoProviderMarketKey(scenario.oddId), scenario.normalizedMarketKey, scenario.name);
    assert.equal(inferSgoParticipantId(scenario.oddId), scenario.participantId, scenario.name);
  }
});

test('SGO oddID contract keeps unsupported player sub-period props deferred', () => {
  const oddId = 'steals-player-LEBRON_JAMES_2544_NBA-1h-ou-over';
  const parsed = parseSgoOddId(oddId);

  assert.ok(parsed);
  assert.equal(parsed.supported, false);
  assert.equal(parsed.normalizedMarketKey, 'steals-all-1h-ou');
  assert.equal(parsed.statEntityKind, 'player');
  assert.equal(parsed.sideId, 'over');
  assert.equal(normalizeSgoProviderMarketKey(oddId), null);
  assert.equal(inferSgoParticipantId(oddId), 'LEBRON_JAMES_2544_NBA');
});

test('SGO oddID contract strips side suffixes without changing base keys', () => {
  assert.equal(stripSgoSideSuffix('points-all-game-ou-under'), 'points-all-game-ou');
  assert.equal(stripSgoSideSuffix('moneyline-home-game-ml-home'), 'moneyline-home-game-ml');
  assert.equal(stripSgoSideSuffix('points-all-game-ou'), 'points-all-game-ou');
});
