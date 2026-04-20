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
  cappers: [{ id: 'griff843', displayName: 'griff843' }],
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
    mapOfferToFormMarketType({ marketTypeId: 'player.points_assists', participantId: 'player-1', providerParticipantId: null }),
    'player-prop',
  );
});

test('mapOfferToFormMarketType identifies MLB player props without canonical participantId', () => {
  // MLB offers often have a providerParticipantId but no canonical participantId
  // because provider_entity_aliases may not have a row yet. The marketTypeId
  // starting with "player_" is the reliable signal.
  assert.equal(
    mapOfferToFormMarketType({ marketTypeId: 'player_batting_hits_ou', participantId: null, providerParticipantId: 'sgo-player-123' }),
    'player-prop',
  );
  assert.equal(
    mapOfferToFormMarketType({ marketTypeId: 'player_batting_home_runs_ou', participantId: null, providerParticipantId: 'sgo-player-456' }),
    'player-prop',
  );
});

test('mapOfferToFormMarketType falls back to providerParticipantId for player props with no marketTypeId', () => {
  assert.equal(
    mapOfferToFormMarketType({ marketTypeId: null, participantId: null, providerParticipantId: 'sgo-player-789' }),
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
  assert.equal(
    inferStatTypeFromMarketTypeId('player_rebs_asts_ou'),
    'Rebounds + Assists',
  );
});

test('inferStatTypeFromMarketTypeId resolves MLB, NHL, and NFL labels', () => {
  assert.equal(
    inferStatTypeFromMarketTypeId('player_pitching_strikeouts_ou'),
    'Pitching Strikeouts',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_pitching_innings_pitched_ou'),
    'Pitching Innings Pitched',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_batting_total_bases_ou'),
    'Total Bases',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_hits_runs_rbis_ou'),
    'Hits + Runs + RBIs',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_earned_runs_ou'),
    'Earned Runs',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_hits_allowed_ou'),
    'Hits Allowed',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_singles_ou'),
    'Singles',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_batting_singles_ou'),
    'Singles',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_doubles_ou'),
    'Doubles',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_batting_doubles_ou'),
    'Doubles',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_triples_ou'),
    'Triples',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_batting_triples_ou'),
    'Triples',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_batting_hrr_ou'),
    'Hits + Runs + RBIs',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_pitching_earned_runs_ou'),
    'Earned Runs',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_pitching_hits_allowed_ou'),
    'Hits Allowed',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_pitching_outs_ou'),
    'Pitcher Outs',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_shots_on_goal_ou'),
    'Shots on Goal',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_blocked_shots_ou'),
    'Blocked Shots',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_receiving_yards_ou'),
    'Receiving Yards',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_rushing_attempts_ou'),
    'Rushing Attempts',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_rush_rec_yards_ou'),
    'Rush + Rec Yards',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_passing_touchdowns_ou'),
    'Passing Touchdowns',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_passing_attempts_ou'),
    'Passing Attempts',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_touchdowns_ou'),
    'Touchdowns',
  );
  assert.equal(
    inferStatTypeFromMarketTypeId('player_tackles_ou'),
    'Tackles',
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
  assert.equal(payload.market, 'player.assists');
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
  assert.equal(payload.metadata?.participantId, 'player-1');
  assert.equal(payload.metadata?.teamId, 'team-1');
  assert.equal(payload.metadata?.sportsbookId, 'fanatics');
  assert.deepEqual(payload.metadata?.selectedOffer, {
    providerKey: 'sgo',
    providerMarketKey: 'nba-player-pa',
    providerParticipantId: 'provider-player-1',
    snapshotAt: '2026-04-02T18:30:00.000Z',
  });
});

test('buildSubmissionPayload uses normalized manual market keys instead of lossy display strings', () => {
  const totalPayload = buildSubmissionPayload(
    buildBaseValues({
      marketType: 'total',
      direction: 'over',
      playerName: '',
      statType: '',
      team: '',
      line: 228.5,
    }),
  );
  const propPayload = buildSubmissionPayload(
    buildBaseValues({
      marketType: 'player-prop',
      statType: 'Points + Assists',
    }),
  );

  assert.equal(totalPayload.market, 'game_total_ou');
  assert.equal(propPayload.market, 'player.points_assists');
});

test('buildSubmissionPayload records sportsbook manual override metadata when book is typed', () => {
  const payload = buildSubmissionPayload(buildBaseValues({ sportsbook: 'PrizePicks' }), {
    manualOverrideFields: ['sportsbook'],
  });

  assert.equal(payload.metadata?.manualEntry, true);
  assert.deepEqual(payload.metadata?.manualOverrideFields, ['sportsbook']);
  assert.equal(payload.metadata?.sportsbook, 'PrizePicks');
  assert.equal(payload.metadata?.sportsbookId, null);
});

// UTV2-615: NHL stat types in STAT_TYPE_TO_SUBMISSION_MARKET_KEY
test('buildSubmissionPayload resolves NHL stat types to canonical player prop market keys', () => {
  const goalsPayload = buildSubmissionPayload(
    buildBaseValues({ sport: 'NHL', statType: 'goals', playerName: 'Connor McDavid' }),
  );
  assert.equal(goalsPayload.market, 'player.goals');

  const shotsPayload = buildSubmissionPayload(
    buildBaseValues({ sport: 'NHL', statType: 'shots on goal', playerName: 'Connor McDavid' }),
  );
  assert.equal(shotsPayload.market, 'player.shots');

  const savesPayload = buildSubmissionPayload(
    buildBaseValues({ sport: 'NHL', statType: 'saves', playerName: 'Marc-Andre Fleury' }),
  );
  assert.equal(savesPayload.market, 'player.saves');

  const pimPayload = buildSubmissionPayload(
    buildBaseValues({ sport: 'NHL', statType: 'penalty minutes', playerName: 'Connor McDavid' }),
  );
  assert.equal(pimPayload.market, 'player.pim');
});

test('buildSubmissionPayload resolves MLB batting strikeouts to player.strikeouts', () => {
  const payload = buildSubmissionPayload(
    buildBaseValues({ sport: 'MLB', statType: 'strikeouts', playerName: 'Aaron Judge' }),
  );
  assert.equal(payload.market, 'player.strikeouts');
});

test('buildSubmissionPayload populates metadata.player from playerName for participant resolution', () => {
  const payload = buildSubmissionPayload(
    buildBaseValues({ sport: 'NHL', statType: 'goals', playerName: 'Connor McDavid' }),
  );
  assert.equal(payload.metadata?.player, 'Connor McDavid');
  assert.equal(payload.metadata?.sport, 'NHL');
});

// UTV2-255: conviction=8/9/4 trust mapping proof
test('conviction=9 maps to trust=90 and confidence=0.9', () => {
  const payload = buildSubmissionPayload(buildBaseValues({ capperConviction: 9 }));
  assert.equal(payload.confidence, 0.9);
  assert.equal(payload.metadata?.capperConviction, 9);
  assert.deepEqual(payload.metadata?.promotionScores, { trust: 90 });
});

test('conviction=4 maps to trust=40 and confidence=0.4', () => {
  const payload = buildSubmissionPayload(buildBaseValues({ capperConviction: 4 }));
  assert.equal(payload.confidence, 0.4);
  assert.equal(payload.metadata?.capperConviction, 4);
  assert.deepEqual(payload.metadata?.promotionScores, { trust: 40 });
});

// UTV2-577: unknown stat type must throw rather than return a lossy display string
test('buildSubmissionPayload throws for unknown player-prop stat type', () => {
  assert.throws(
    () =>
      buildSubmissionPayload(
        buildBaseValues({ marketType: 'player-prop', statType: 'unknown-future-stat' }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('Cannot resolve canonical market key'),
        `Expected error to mention canonical market key, got: ${err.message}`,
      );
      return true;
    },
  );
});

// UTV2-577: NHL stat types resolve to canonical market keys
test('buildSubmissionPayload resolves NHL stat types to canonical keys', () => {
  const goalsPayload = buildSubmissionPayload(
    buildBaseValues({ sport: 'NHL', statType: 'Goals' }),
  );
  assert.equal(goalsPayload.market, 'player.goals');

  const sogPayload = buildSubmissionPayload(
    buildBaseValues({ sport: 'NHL', statType: 'Shots on Goal' }),
  );
  assert.equal(sogPayload.market, 'player.shots');

  const blockedPayload = buildSubmissionPayload(
    buildBaseValues({ sport: 'NHL', statType: 'Blocked Shots' }),
  );
  assert.equal(blockedPayload.market, 'player.blocked_shots');
});
