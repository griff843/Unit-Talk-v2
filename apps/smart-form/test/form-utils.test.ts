import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSelectionString,
  buildSubmissionPayload,
  calcPayout,
  inferStatTypeFromMarketTypeId,
  mapOfferToFormMarketType,
  resolveSportsbookId,
} from '../lib/form-utils.ts';
import type { BetFormValues } from '../lib/form-schema.ts';
import type { CatalogData } from '../lib/catalog.ts';

function buildBaseValues(overrides: Partial<BetFormValues> = {}): BetFormValues {
  return {
    sport: 'NBA',
    marketType: 'player-prop',
    eventName: 'Nuggets vs Jazz',
    playerName: 'Jamal Murray',
    statType: 'Assists',
    direction: 'over',
    line: 7,
    sportsbook: 'Fanatics',
    odds: -140,
    units: 1.5,
    capperConviction: 8,
    capper: 'griff843',
    gameDate: '2026-04-02',
    ...overrides,
  };
}

const catalog: CatalogData = {
  sports: [],
  sportsbooks: [
    { id: 'fanatics', name: 'Fanatics' },
    { id: 'draftkings', name: 'DraftKings' },
  ],
  ticketTypes: [],
  cappers: ['griff843'],
};

test('calcPayout returns profit for positive American odds', () => {
  assert.equal(calcPayout(2, 150), 3);
});

test('calcPayout returns profit for negative American odds', () => {
  const result = calcPayout(1, -110);
  assert.ok(result !== null);
  assert.ok(Math.abs(result - 0.909) < 0.01);
});

test('calcPayout returns null for invalid values', () => {
  assert.equal(calcPayout(0, -110), null);
  assert.equal(calcPayout(1, 0), null);
  assert.equal(calcPayout(-1, 200), null);
});

test('buildSelectionString formats player props', () => {
  assert.equal(buildSelectionString(buildBaseValues()), 'Jamal Murray Assists O 7');
});

test('buildSelectionString formats moneylines', () => {
  assert.equal(
    buildSelectionString(buildBaseValues({ marketType: 'moneyline', team: 'Nuggets' })),
    'Nuggets',
  );
});

test('buildSelectionString formats spreads', () => {
  assert.equal(
    buildSelectionString(buildBaseValues({ marketType: 'spread', team: 'Jazz', line: 3.5 })),
    'Jazz +3.5',
  );
});

test('buildSelectionString formats totals', () => {
  assert.equal(
    buildSelectionString(buildBaseValues({ marketType: 'total', line: 229.5, playerName: undefined, statType: undefined })),
    'O 229.5',
  );
});

test('buildSelectionString formats team totals', () => {
  assert.equal(
    buildSelectionString(buildBaseValues({ marketType: 'team-total', team: 'Nuggets', line: 116.5 })),
    'Nuggets Over 116.5',
  );
});

test('mapOfferToFormMarketType identifies combo player props', () => {
  assert.equal(
    mapOfferToFormMarketType({ marketTypeId: 'player.points_assists', participantId: 'player-1' }),
    'player-prop',
  );
});

test('inferStatTypeFromMarketTypeId resolves combo stat labels', () => {
  assert.equal(
    inferStatTypeFromMarketTypeId('player.points_assists'),
    'Points + Assists',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player.pra'),
    'Points + Rebounds + Assists',
  );
});

test('resolveSportsbookId matches by canonical id and display name', () => {
  assert.equal(resolveSportsbookId(catalog, 'fanatics'), 'fanatics');
  assert.equal(resolveSportsbookId(catalog, 'Fanatics'), 'fanatics');
  assert.equal(resolveSportsbookId(catalog, 'Unknown'), null);
});

test('buildSubmissionPayload keeps smart-form identity and conviction mapping', () => {
  const payload = buildSubmissionPayload(buildBaseValues());

  assert.equal(payload.source, 'smart-form');
  assert.equal(payload.submittedBy, 'griff843');
  assert.equal(payload.market, 'NBA - Player Prop');
  assert.equal(payload.selection, 'Jamal Murray Assists O 7');
  assert.equal(payload.confidence, 0.8);
  assert.equal(payload.metadata?.capperConviction, 8);
  assert.deepEqual(payload.metadata?.promotionScores, { trust: 80 });
});

test('buildSubmissionPayload records canonical browse metadata for live-offer selections', () => {
  const payload = buildSubmissionPayload(buildBaseValues(), {
    submissionMode: 'live-offer',
    eventId: 'evt-1',
    leagueId: 'nba',
    playerId: 'player-1',
    teamId: 'team-1',
    canonicalMarketTypeId: 'player.points_assists',
    sportsbookId: 'fanatics',
    selectedOffer: {
      providerKey: 'sgo',
      providerMarketKey: 'nba-player-pa',
      providerParticipantId: 'provider-player-1',
      snapshotAt: '2026-04-02T18:30:00.000Z',
    },
  });

  assert.equal(payload.market, 'player.points_assists');
  assert.equal(payload.metadata?.submissionMode, 'live-offer');
  assert.equal(payload.metadata?.eventId, 'evt-1');
  assert.equal(payload.metadata?.leagueId, 'nba');
  assert.equal(payload.metadata?.playerId, 'player-1');
  assert.equal(payload.metadata?.teamId, 'team-1');
  assert.equal(payload.metadata?.sportsbookId, 'fanatics');
  assert.deepEqual(payload.metadata?.selectedOffer, {
    providerKey: 'sgo',
    providerMarketKey: 'nba-player-pa',
    providerParticipantId: 'provider-player-1',
    snapshotAt: '2026-04-02T18:30:00.000Z',
  });
});
