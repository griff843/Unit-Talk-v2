import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  americanToImpliedProbability,
  classifyHedgeOpportunity,
  detectHedgeOpportunities,
} from './hedge-detection.js';

test('classifyHedgeOpportunity returns arbitrage with guaranteed profit', () => {
  const opportunity = classifyHedgeOpportunity({
    providerEventId: 'evt-1',
    providerParticipantId: 'player-1',
    marketKey: 'player_points',
    bookmakerA: 'draftkings',
    bookmakerB: 'fanduel',
    lineA: 4.5,
    lineB: 6.5,
    overOddsA: 200,
    underOddsB: 200,
  });

  assert.ok(opportunity);
  assert.equal(opportunity?.type, 'arbitrage');
  assert.equal(opportunity?.priority, 'critical');
  assert.ok((opportunity?.guaranteedProfit ?? 0) > 0);
  assert.equal(opportunity?.middleGap, null);
  assert.equal(opportunity?.winProbability, null);
});

test('classifyHedgeOpportunity returns middle for a non-arb gap over the middle threshold', () => {
  const opportunity = classifyHedgeOpportunity({
    providerEventId: 'evt-2',
    providerParticipantId: null,
    marketKey: 'player_points',
    bookmakerA: 'draftkings',
    bookmakerB: 'fanduel',
    lineA: 4.5,
    lineB: 7.0,
    overOddsA: -110,
    underOddsB: -110,
  });

  assert.ok(opportunity);
  assert.equal(opportunity?.type, 'middle');
  assert.equal(opportunity?.priority, 'low');
  assert.equal(opportunity?.middleGap, 2.5);
  assert.ok((opportunity?.winProbability ?? 0) > 0);
  assert.equal(opportunity?.guaranteedProfit, null);
});

test('classifyHedgeOpportunity returns hedge for a larger non-arb gap', () => {
  const opportunity = classifyHedgeOpportunity({
    providerEventId: 'evt-3',
    providerParticipantId: null,
    marketKey: 'spread',
    bookmakerA: 'draftkings',
    bookmakerB: 'fanduel',
    lineA: 3.5,
    lineB: 6.5,
    overOddsA: -110,
    underOddsB: -110,
  });

  assert.ok(opportunity);
  assert.equal(opportunity?.type, 'hedge');
  assert.equal(opportunity?.priority, 'low');
  assert.equal(opportunity?.middleGap, null);
  assert.equal(opportunity?.winProbability, null);
});

test('classifyHedgeOpportunity discards gaps below the minimum threshold', () => {
  const opportunity = classifyHedgeOpportunity({
    providerEventId: 'evt-4',
    providerParticipantId: null,
    marketKey: 'total',
    bookmakerA: 'draftkings',
    bookmakerB: 'fanduel',
    lineA: 220.5,
    lineB: 221.0,
    overOddsA: -110,
    underOddsB: -110,
  });

  assert.equal(opportunity, null);
});

test('detectHedgeOpportunities keeps the latest snapshot per bookmaker', () => {
  const opportunities = detectHedgeOpportunities([
    makeOffer({
      id: 'old-a',
      providerKey: 'draftkings',
      line: 4.5,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
    makeOffer({
      id: 'new-a',
      providerKey: 'draftkings',
      line: 5.0,
      snapshotAt: '2026-03-28T10:10:00.000Z',
    }),
    makeOffer({
      id: 'book-b',
      providerKey: 'fanduel',
      line: 7.5,
      snapshotAt: '2026-03-28T10:08:00.000Z',
    }),
  ]);

  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0]?.bookmakerA, 'draftkings');
  assert.equal(opportunities[0]?.lineA, 5.0);
  assert.equal(opportunities[0]?.lineB, 7.5);
  assert.equal(opportunities[0]?.type, 'middle');
});

test('americanToImpliedProbability handles positive and negative odds', () => {
  assert.equal(americanToImpliedProbability(200), 0.3333333333333333);
  assert.equal(americanToImpliedProbability(-150), 0.6);
  assert.equal(americanToImpliedProbability(0), null);
});

function makeOffer(
  overrides: Partial<{
    id: string;
    providerKey: string;
    providerEventId: string;
    providerMarketKey: string;
    providerParticipantId: string | null;
    line: number | null;
    overOdds: number | null;
    underOdds: number | null;
    snapshotAt: string;
  }> = {},
) {
  return {
    id: overrides.id ?? randomUUID(),
    provider_key: overrides.providerKey ?? 'draftkings',
    provider_event_id: overrides.providerEventId ?? 'evt-domain-1',
    provider_market_key: overrides.providerMarketKey ?? 'player_points',
    provider_participant_id:
      overrides.providerParticipantId !== undefined ? overrides.providerParticipantId : 'player-1',
    line: overrides.line ?? 4.5,
    over_odds: overrides.overOdds ?? -110,
    under_odds: overrides.underOdds ?? -110,
    snapshot_at: overrides.snapshotAt ?? '2026-03-28T10:00:00.000Z',
    created_at: overrides.snapshotAt ?? '2026-03-28T10:00:00.000Z',
  };
}
