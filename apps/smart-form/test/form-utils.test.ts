/**
 * Tests for live Next.js smart form utilities (lib/form-utils.ts).
 * Covers payload mapping and selection string construction.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  buildSelectionString,
  buildSubmissionPayload,
  calcPayout,
} from '../lib/form-utils.ts';
import type { BetFormValues } from '../lib/form-schema.ts';

// --- calcPayout ---

describe('calcPayout', () => {
  test('+150 odds, 2 units -> 3.0 profit', () => {
    const result = calcPayout(2, 150);
    assert.ok(result !== null);
    assert.ok(Math.abs(result - 3.0) < 0.01, `Expected 3.0, got ${result}`);
  });

  test('-110 odds, 1 unit -> ~0.909 profit', () => {
    const result = calcPayout(1, -110);
    assert.ok(result !== null);
    assert.ok(Math.abs(result - 0.909) < 0.01, `Expected ~0.909, got ${result}`);
  });

  test('+100 odds, 1 unit -> 1.0 profit', () => {
    const result = calcPayout(1, 100);
    assert.equal(result, 1.0);
  });

  test('-100 odds, 1 unit -> 1.0 profit', () => {
    const result = calcPayout(1, -100);
    assert.equal(result, 1.0);
  });

  test('0 units returns null', () => {
    assert.equal(calcPayout(0, -110), null);
  });

  test('0 odds returns null', () => {
    assert.equal(calcPayout(1, 0), null);
  });

  test('negative units returns null', () => {
    assert.equal(calcPayout(-1, -110), null);
  });
});

// --- buildSelectionString ---

describe('buildSelectionString', () => {
  function base(overrides: Partial<BetFormValues>): BetFormValues {
    return {
      sport: 'NBA',
      marketType: 'player-prop',
      eventName: 'Knicks vs Heat',
      playerName: 'Jalen Brunson',
      statType: 'Points',
      direction: 'over',
      line: 24.5,
      sportsbook: 'DraftKings',
      odds: -110,
      units: 1.5,
      capperConviction: 8,
      capper: 'griff843',
      gameDate: '2026-03-22',
      ...overrides,
    };
  }

  test('player-prop: player statType O line', () => {
    const result = buildSelectionString(base({ marketType: 'player-prop', direction: 'over' }));
    assert.equal(result, 'Jalen Brunson Points O 24.5');
  });

  test('player-prop: under direction uses U', () => {
    const result = buildSelectionString(base({ marketType: 'player-prop', direction: 'under' }));
    assert.equal(result, 'Jalen Brunson Points U 24.5');
  });

  test('moneyline: team only', () => {
    const result = buildSelectionString(base({ marketType: 'moneyline', team: 'Knicks' }));
    assert.equal(result, 'Knicks');
  });

  test('spread: team with negative line', () => {
    const result = buildSelectionString(base({ marketType: 'spread', team: 'Knicks', line: -3.5 }));
    assert.equal(result, 'Knicks -3.5');
  });

  test('spread: team with positive line gets + prefix', () => {
    const result = buildSelectionString(base({ marketType: 'spread', team: 'Heat', line: 3.5 }));
    assert.equal(result, 'Heat +3.5');
  });

  test('total: direction and line', () => {
    const result = buildSelectionString(
      base({ marketType: 'total', direction: 'over', line: 215.5 }),
    );
    assert.equal(result, 'O 215.5');
  });

  test('total: under direction', () => {
    const result = buildSelectionString(
      base({ marketType: 'total', direction: 'under', line: 215.5 }),
    );
    assert.equal(result, 'U 215.5');
  });

  test('team-total: team direction line', () => {
    const result = buildSelectionString(
      base({ marketType: 'team-total', team: 'Knicks', direction: 'over', line: 108.5 }),
    );
    assert.equal(result, 'Knicks Over 108.5');
  });
});

// --- buildSubmissionPayload ---

describe('buildSubmissionPayload', () => {
  function playerPropValues(overrides: Partial<BetFormValues> = {}): BetFormValues {
    return {
      sport: 'NBA',
      marketType: 'player-prop',
      eventName: 'Knicks vs Heat',
      playerName: 'Jalen Brunson',
      statType: 'Points',
      direction: 'over',
      line: 24.5,
      sportsbook: 'DraftKings',
      odds: -110,
      units: 1.5,
      capperConviction: 8,
      capper: 'griff843',
      gameDate: '2026-03-22',
      ...overrides,
    };
  }

  function moneylineValues(): BetFormValues {
    return {
      sport: 'NFL',
      marketType: 'moneyline',
      eventName: 'Bills vs Chiefs',
      team: 'Bills',
      sportsbook: 'FanDuel',
      odds: 150,
      units: 2.0,
      capperConviction: 7,
      capper: 'griff843',
      gameDate: '2026-03-22',
    };
  }

  test('source is smart-form (contract identity)', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.source, 'smart-form');
  });

  test('submittedBy is the capper', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.submittedBy, 'griff843');
  });

  test('stakeUnits maps from units', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.stakeUnits, 1.5);
  });

  test('odds are passed through', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.odds, -110);
  });

  test('eventName maps to eventName', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.eventName, 'Knicks vs Heat');
  });

  test('line maps to line', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.line, 24.5);
  });

  test('market includes sport and market type label', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.ok(payload.market.startsWith('NBA'));
    assert.ok(payload.market.includes('Player Prop'));
  });

  test('market separator is not a special char', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    // Market must not contain the middle dot (U+00B7) — encoding defect
    assert.ok(!payload.market.includes('\u00B7'), `Market contained middle dot: ${payload.market}`);
  });

  test('selection for player-prop includes player, stat, direction, line', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.ok(payload.selection.includes('Jalen Brunson'));
    assert.ok(payload.selection.includes('Points'));
    assert.ok(payload.selection.includes('24.5'));
  });

  test('metadata.sport is set', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.metadata?.sport, 'NBA');
  });

  test('metadata.marketType is set', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.metadata?.marketType, 'player-prop');
  });

  test('metadata.capper is set', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.metadata?.capper, 'griff843');
  });

  test('moneyline: no line in payload', () => {
    const payload = buildSubmissionPayload(moneylineValues());
    assert.equal(payload.line, undefined);
  });

  test('moneyline: source is still smart-form', () => {
    const payload = buildSubmissionPayload(moneylineValues());
    assert.equal(payload.source, 'smart-form');
  });

  test('moneyline: selection is team name', () => {
    const payload = buildSubmissionPayload(moneylineValues());
    assert.equal(payload.selection, 'Bills');
  });

  test('metadata.ticketType is single', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.metadata?.ticketType, 'single');
  });

  test('metadata.player maps from playerName', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.metadata?.player, 'Jalen Brunson');
  });

  test('metadata.overUnder maps from direction', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.metadata?.overUnder, 'over');
  });

  test('metadata.date maps from gameDate', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.metadata?.date, '2026-03-22');
  });

  test('metadata.eventName is set', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.metadata?.eventName, 'Knicks vs Heat');
  });

  test('conviction 8 maps to promotionScores.trust 80', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.equal(payload.metadata?.promotionScores?.trust, 80);
  });

  test('conviction 1 maps to promotionScores.trust 10', () => {
    const payload = buildSubmissionPayload(playerPropValues({ capperConviction: 1 }));
    assert.equal(payload.metadata?.promotionScores?.trust, 10);
  });

  test('conviction 10 maps to promotionScores.trust 100', () => {
    const payload = buildSubmissionPayload(playerPropValues({ capperConviction: 10 }));
    assert.equal(payload.metadata?.promotionScores?.trust, 100);
  });

  test('metadata preserves submitted conviction value', () => {
    const payload = buildSubmissionPayload(playerPropValues({ capperConviction: 9 }));
    assert.equal(payload.metadata?.capperConviction, 9);
  });

  test('promotionScores is present in submitted payload for valid conviction', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.deepEqual(payload.metadata?.promotionScores, { trust: 80 });
  });

  test('metadata does not contain legacy playerName key', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.ok(!('playerName' in (payload.metadata ?? {})), 'metadata should not have playerName key');
  });

  test('metadata does not contain legacy direction key', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.ok(!('direction' in (payload.metadata ?? {})), 'metadata should not have direction key');
  });

  test('metadata does not contain legacy gameDate key', () => {
    const payload = buildSubmissionPayload(playerPropValues());
    assert.ok(!('gameDate' in (payload.metadata ?? {})), 'metadata should not have gameDate key');
  });
});
