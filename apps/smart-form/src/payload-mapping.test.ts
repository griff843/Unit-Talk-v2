import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  constructMarket,
  constructSelection,
  mapSmartFormToSubmissionPayload,
  decimalToAmerican,
  normalizeOdds,
} from './payload-mapping.js';
import type { ParsedSmartFormBody } from './validation.js';

// --- constructMarket ---

describe('constructMarket', () => {
  test('player-prop with stat type', () => {
    assert.equal(constructMarket('NBA', 'player-prop', 'Points'), 'NBA Points');
  });

  test('player-prop without stat type falls back to Prop', () => {
    assert.equal(constructMarket('NBA', 'player-prop'), 'NBA Prop');
  });

  test('moneyline', () => {
    assert.equal(constructMarket('NFL', 'moneyline'), 'NFL Moneyline');
  });

  test('spread', () => {
    assert.equal(constructMarket('NBA', 'spread'), 'NBA Spread');
  });

  test('total', () => {
    assert.equal(constructMarket('NHL', 'total'), 'NHL Total');
  });

  test('team-total', () => {
    assert.equal(constructMarket('NBA', 'team-total'), 'NBA Team Total');
  });
});

// --- constructSelection ---

describe('constructSelection', () => {
  test('player-prop', () => {
    const form: ParsedSmartFormBody = { player: 'Jalen Brunson', overUnder: 'Over', line: '24.5' };
    assert.equal(constructSelection('player-prop', form), 'Jalen Brunson Over 24.5');
  });

  test('moneyline', () => {
    const form: ParsedSmartFormBody = { team: 'Knicks' };
    assert.equal(constructSelection('moneyline', form), 'Knicks');
  });

  test('spread with negative line', () => {
    const form: ParsedSmartFormBody = { team: 'Knicks', line: '-3.5' };
    assert.equal(constructSelection('spread', form), 'Knicks -3.5');
  });

  test('spread with positive line gets + prefix', () => {
    const form: ParsedSmartFormBody = { team: 'Heat', line: '7' };
    assert.equal(constructSelection('spread', form), 'Heat +7');
  });

  test('total', () => {
    const form: ParsedSmartFormBody = { overUnder: 'Over', line: '215.5' };
    assert.equal(constructSelection('total', form), 'Over 215.5');
  });

  test('team-total', () => {
    const form: ParsedSmartFormBody = { team: 'Knicks', overUnder: 'Over', line: '108.5' };
    assert.equal(constructSelection('team-total', form), 'Knicks Over 108.5');
  });
});

// --- decimalToAmerican ---

describe('decimalToAmerican', () => {
  test('2.0 -> +100', () => {
    assert.equal(decimalToAmerican(2.0), 100);
  });

  test('1.91 -> -110 (approx)', () => {
    assert.equal(decimalToAmerican(1.91), -110);
  });

  test('3.0 -> +200', () => {
    assert.equal(decimalToAmerican(3.0), 200);
  });

  test('1.5 -> -200', () => {
    assert.equal(decimalToAmerican(1.5), -200);
  });
});

// --- normalizeOdds ---

describe('normalizeOdds', () => {
  test('american format passes through', () => {
    assert.equal(normalizeOdds('-110', 'american'), -110);
  });

  test('decimal format converts to american', () => {
    assert.equal(normalizeOdds('1.91', 'decimal'), -110);
  });

  test('undefined odds returns undefined', () => {
    assert.equal(normalizeOdds(undefined, 'american'), undefined);
  });

  test('empty string returns undefined', () => {
    assert.equal(normalizeOdds('', 'american'), undefined);
  });

  test('non-numeric returns undefined', () => {
    assert.equal(normalizeOdds('abc', 'american'), undefined);
  });
});

// --- Full payload mapping ---

describe('mapSmartFormToSubmissionPayload', () => {
  test('player-prop full mapping', () => {
    const form: ParsedSmartFormBody = {
      capper: 'griff843',
      date: '2026-03-21',
      sport: 'NBA',
      sportsbook: 'DraftKings',
      units: '1.5',
      oddsFormat: 'american',
      odds: '-110',
      player: 'Jalen Brunson',
      matchup: 'Knicks vs Heat',
      statType: 'Points',
      overUnder: 'Over',
      line: '24.5',
    };

    const payload = mapSmartFormToSubmissionPayload(form, 'player-prop');

    assert.equal(payload.source, 'smart-form');
    assert.equal(payload.submittedBy, 'griff843');
    assert.equal(payload.market, 'NBA Points');
    assert.equal(payload.selection, 'Jalen Brunson Over 24.5');
    assert.equal(payload.line, 24.5);
    assert.equal(payload.odds, -110);
    assert.equal(payload.stakeUnits, 1.5);
    assert.equal(payload.eventName, 'Knicks vs Heat');
    assert.equal(payload.metadata.ticketType, 'single');
    assert.equal(payload.metadata.capper, 'griff843');
    assert.equal(payload.metadata.sport, 'NBA');
    assert.equal(payload.metadata.marketType, 'player-prop');
    assert.equal(payload.metadata.player, 'Jalen Brunson');
    assert.equal(payload.metadata.statType, 'Points');
    assert.equal(payload.metadata.overUnder, 'Over');
  });

  test('moneyline mapping', () => {
    const form: ParsedSmartFormBody = {
      capper: 'griff843',
      date: '2026-03-21',
      sport: 'NFL',
      units: '2',
      odds: '+150',
      matchup: 'Bills vs Chiefs',
      team: 'Bills',
    };

    const payload = mapSmartFormToSubmissionPayload(form, 'moneyline');

    assert.equal(payload.market, 'NFL Moneyline');
    assert.equal(payload.selection, 'Bills');
    assert.equal(payload.metadata.team, 'Bills');
    assert.equal(payload.metadata.marketType, 'moneyline');
  });

  test('spread mapping', () => {
    const form: ParsedSmartFormBody = {
      capper: 'griff843',
      date: '2026-03-21',
      sport: 'NBA',
      units: '1',
      odds: '-110',
      matchup: 'Knicks vs Heat',
      team: 'Knicks',
      line: '-3.5',
    };

    const payload = mapSmartFormToSubmissionPayload(form, 'spread');

    assert.equal(payload.market, 'NBA Spread');
    assert.equal(payload.selection, 'Knicks -3.5');
    assert.equal(payload.line, -3.5);
  });

  test('total mapping', () => {
    const form: ParsedSmartFormBody = {
      capper: 'griff843',
      date: '2026-03-21',
      sport: 'NHL',
      units: '1',
      odds: '-115',
      matchup: 'Rangers vs Bruins',
      overUnder: 'Under',
      line: '5.5',
    };

    const payload = mapSmartFormToSubmissionPayload(form, 'total');

    assert.equal(payload.market, 'NHL Total');
    assert.equal(payload.selection, 'Under 5.5');
    assert.equal(payload.metadata.overUnder, 'Under');
  });

  test('team-total mapping', () => {
    const form: ParsedSmartFormBody = {
      capper: 'griff843',
      date: '2026-03-21',
      sport: 'NBA',
      units: '1',
      odds: '-110',
      matchup: 'Knicks vs Heat',
      team: 'Knicks',
      overUnder: 'Over',
      line: '108.5',
    };

    const payload = mapSmartFormToSubmissionPayload(form, 'team-total');

    assert.equal(payload.market, 'NBA Team Total');
    assert.equal(payload.selection, 'Knicks Over 108.5');
    assert.equal(payload.metadata.team, 'Knicks');
    assert.equal(payload.metadata.overUnder, 'Over');
  });

  test('metadata omits absent optional fields', () => {
    const form: ParsedSmartFormBody = {
      capper: 'griff843',
      date: '2026-03-21',
      sport: 'NFL',
      units: '1',
      odds: '-110',
      matchup: 'Bills vs Chiefs',
      team: 'Bills',
    };

    const payload = mapSmartFormToSubmissionPayload(form, 'moneyline');

    assert.equal(payload.metadata.player, undefined);
    assert.equal(payload.metadata.statType, undefined);
    assert.equal(payload.metadata.sportsbook, undefined);
  });

  test('metadata always includes ticketType single', () => {
    const form: ParsedSmartFormBody = {
      capper: 'griff843',
      date: '2026-03-21',
      sport: 'NBA',
      units: '1',
      odds: '-110',
      matchup: 'Knicks vs Heat',
      team: 'Knicks',
    };

    const payload = mapSmartFormToSubmissionPayload(form, 'moneyline');
    assert.equal(payload.metadata.ticketType, 'single');
  });

  test('decimal odds are converted to american', () => {
    const form: ParsedSmartFormBody = {
      capper: 'griff843',
      date: '2026-03-21',
      sport: 'NBA',
      units: '1',
      oddsFormat: 'decimal',
      odds: '1.91',
      matchup: 'Knicks vs Heat',
      team: 'Knicks',
    };

    const payload = mapSmartFormToSubmissionPayload(form, 'moneyline');

    assert.equal(payload.odds, -110);
  });
});
