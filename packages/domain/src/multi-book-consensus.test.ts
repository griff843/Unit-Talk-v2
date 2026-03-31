import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeMultiBookConsensus,
  computeConsensusFromOffers,
  detectOddsDiscrepancies,
  type ProviderOddsSnapshot,
} from './multi-book-consensus.js';

test('computeMultiBookConsensus returns empty result for no snapshots', () => {
  const result = computeMultiBookConsensus([]);
  assert.equal(result.providerCount, 0);
  assert.equal(result.consensusLine, null);
  assert.equal(result.hasDiscrepancy, false);
});

test('computeMultiBookConsensus with single provider', () => {
  const snapshots: ProviderOddsSnapshot[] = [
    { providerKey: 'sgo', overOdds: -110, underOdds: -110, line: 7.5, snapshotAt: '2026-03-31T00:00:00Z' },
  ];
  const result = computeMultiBookConsensus(snapshots);
  assert.equal(result.providerCount, 1);
  assert.deepEqual(result.providers, ['sgo']);
  assert.equal(result.consensusLine, 7.5);
  assert.equal(result.consensusOverOdds, -110);
  assert.equal(result.maxOddsSpread, null); // need 2+ to compute spread
  assert.equal(result.hasDiscrepancy, false);
});

test('computeMultiBookConsensus with two providers — no discrepancy', () => {
  const snapshots: ProviderOddsSnapshot[] = [
    { providerKey: 'sgo', overOdds: -110, underOdds: -110, line: 7.5, snapshotAt: '2026-03-31T00:00:00Z' },
    { providerKey: 'provider2', overOdds: -108, underOdds: -112, line: 7.5, snapshotAt: '2026-03-31T00:00:00Z' },
  ];
  const result = computeMultiBookConsensus(snapshots);
  assert.equal(result.providerCount, 2);
  assert.equal(result.consensusLine, 7.5);
  assert.equal(result.consensusOverOdds, -109); // median of -110 and -108
  assert.equal(result.maxOddsSpread, 2); // |-108 - (-110)| = 2
  assert.equal(result.hasDiscrepancy, false); // 2 < 20 threshold
});

test('computeMultiBookConsensus detects discrepancy when spread exceeds threshold', () => {
  const snapshots: ProviderOddsSnapshot[] = [
    { providerKey: 'book_a', overOdds: -110, underOdds: -110, line: 7.5, snapshotAt: '2026-03-31T00:00:00Z' },
    { providerKey: 'book_b', overOdds: -135, underOdds: -85, line: 7.5, snapshotAt: '2026-03-31T00:00:00Z' },
  ];
  const result = computeMultiBookConsensus(snapshots);
  assert.equal(result.maxOddsSpread, 25); // |-110 - (-135)| = 25
  assert.equal(result.hasDiscrepancy, true);
});

test('computeMultiBookConsensus computes median line for 3 providers', () => {
  const snapshots: ProviderOddsSnapshot[] = [
    { providerKey: 'a', overOdds: -110, underOdds: -110, line: 7.0, snapshotAt: '2026-03-31T00:00:00Z' },
    { providerKey: 'b', overOdds: -110, underOdds: -110, line: 7.5, snapshotAt: '2026-03-31T00:00:00Z' },
    { providerKey: 'c', overOdds: -110, underOdds: -110, line: 8.0, snapshotAt: '2026-03-31T00:00:00Z' },
  ];
  const result = computeMultiBookConsensus(snapshots);
  assert.equal(result.consensusLine, 7.5); // median
  assert.equal(result.maxLineSpread, 1.0);
});

test('computeConsensusFromOffers groups by market key + participant', () => {
  const offers = [
    { providerKey: 'sgo', providerMarketKey: 'points-all-game-ou', providerParticipantId: null, overOdds: -110, underOdds: -110, line: 220.5, snapshotAt: '2026-03-31T00:00:00Z' },
    { providerKey: 'provider2', providerMarketKey: 'points-all-game-ou', providerParticipantId: null, overOdds: -108, underOdds: -112, line: 221.0, snapshotAt: '2026-03-31T00:00:00Z' },
    { providerKey: 'sgo', providerMarketKey: 'points-player1-game-ou', providerParticipantId: 'player1', overOdds: -115, underOdds: -105, line: 25.5, snapshotAt: '2026-03-31T00:00:00Z' },
  ];

  const results = computeConsensusFromOffers(offers);
  assert.equal(results.size, 2);

  const teamTotal = results.get('points-all-game-ou:all');
  assert.ok(teamTotal);
  assert.equal(teamTotal.providerCount, 2);
  assert.equal(teamTotal.consensusLine, 220.75);

  const playerProp = results.get('points-player1-game-ou:player1');
  assert.ok(playerProp);
  assert.equal(playerProp.providerCount, 1);
});

test('detectOddsDiscrepancies filters to only discrepant markets', () => {
  const consensusMap = new Map();
  consensusMap.set('market-a', { hasDiscrepancy: false, providerCount: 2, providers: ['a', 'b'], consensusLine: 7.5, consensusOverOdds: -110, consensusUnderOdds: -110, maxOddsSpread: 5, maxLineSpread: 0, breakdown: [] });
  consensusMap.set('market-b', { hasDiscrepancy: true, providerCount: 2, providers: ['a', 'b'], consensusLine: 7.5, consensusOverOdds: -110, consensusUnderOdds: -110, maxOddsSpread: 25, maxLineSpread: 0.5, breakdown: [] });

  const discrepancies = detectOddsDiscrepancies(consensusMap);
  assert.equal(discrepancies.length, 1);
  assert.equal(discrepancies[0]!.marketKey, 'market-b');
});
