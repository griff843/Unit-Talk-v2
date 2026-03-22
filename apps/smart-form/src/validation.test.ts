import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  validateSmartFormSubmission,
  getBlockingErrors,
  getWarnings,
  isValidMarketType,
  type ParsedSmartFormBody,
  type MarketType,
} from './validation.js';
import { V1_REFERENCE_DATA } from '@unit-talk/contracts';

const catalog = V1_REFERENCE_DATA;

// --- Helpers ---

function validBase(overrides: Partial<ParsedSmartFormBody> = {}): ParsedSmartFormBody {
  return {
    capper: 'griff843',
    date: '2026-03-21',
    sport: 'NBA',
    sportsbook: 'draftkings',
    units: '1.5',
    oddsFormat: 'American',
    odds: '-110',
    ...overrides,
  };
}

function validPlayerProp(overrides: Partial<ParsedSmartFormBody> = {}): ParsedSmartFormBody {
  return validBase({
    player: 'Jalen Brunson',
    matchup: 'Knicks vs Heat',
    statType: 'Points',
    overUnder: 'Over',
    line: '24.5',
    ...overrides,
  });
}

function validMoneyline(overrides: Partial<ParsedSmartFormBody> = {}): ParsedSmartFormBody {
  return validBase({
    matchup: 'Knicks vs Heat',
    team: 'Knicks',
    ...overrides,
  });
}

function validSpread(overrides: Partial<ParsedSmartFormBody> = {}): ParsedSmartFormBody {
  return validBase({
    matchup: 'Knicks vs Heat',
    team: 'Knicks',
    line: '-3.5',
    ...overrides,
  });
}

function validTotal(overrides: Partial<ParsedSmartFormBody> = {}): ParsedSmartFormBody {
  return validBase({
    matchup: 'Knicks vs Heat',
    overUnder: 'Over',
    line: '215.5',
    ...overrides,
  });
}

function validTeamTotal(overrides: Partial<ParsedSmartFormBody> = {}): ParsedSmartFormBody {
  return validBase({
    matchup: 'Knicks vs Heat',
    team: 'Knicks',
    overUnder: 'Over',
    line: '108.5',
    ...overrides,
  });
}

function blockingFields(form: ParsedSmartFormBody, marketType: MarketType | undefined): string[] {
  return getBlockingErrors(validateSmartFormSubmission(form, marketType, catalog)).map((e) => e.field);
}

function warningFields(form: ParsedSmartFormBody, marketType: MarketType | undefined): string[] {
  return getWarnings(validateSmartFormSubmission(form, marketType, catalog)).map((e) => e.field);
}

// --- Tests ---

describe('isValidMarketType', () => {
  test('accepts all 5 valid market types', () => {
    for (const mt of ['player-prop', 'moneyline', 'spread', 'total', 'team-total']) {
      assert.equal(isValidMarketType(mt), true, `${mt} should be valid`);
    }
  });

  test('rejects invalid values', () => {
    assert.equal(isValidMarketType(undefined), false);
    assert.equal(isValidMarketType(''), false);
    assert.equal(isValidMarketType('parlay'), false);
  });
});

// --- Universal required fields ---

describe('universal required fields', () => {
  test('valid player prop form produces no blocking errors', () => {
    const errors = getBlockingErrors(validateSmartFormSubmission(validPlayerProp(), 'player-prop', catalog));
    assert.equal(errors.length, 0);
  });

  test('missing capper is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ capper: '' }), 'player-prop');
    assert.ok(fields.includes('capper'));
  });

  test('missing date is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ date: '' }), 'player-prop');
    assert.ok(fields.includes('date'));
  });

  test('invalid date format is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ date: '03/21/2026' }), 'player-prop');
    assert.ok(fields.includes('date'));
  });

  test('impossible date is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ date: '2026-02-30' }), 'player-prop');
    assert.ok(fields.includes('date'));
  });

  test('missing sport is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ sport: '' }), 'player-prop');
    assert.ok(fields.includes('sport'));
  });

  test('missing market type is a blocking error', () => {
    const fields = blockingFields(validPlayerProp(), undefined);
    assert.ok(fields.includes('marketType'));
  });

  test('missing odds is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ odds: '' }), 'player-prop');
    assert.ok(fields.includes('odds'));
  });

  test('zero odds is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ odds: '0' }), 'player-prop');
    assert.ok(fields.includes('odds'));
  });

  test('non-finite odds is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ odds: 'abc' }), 'player-prop');
    assert.ok(fields.includes('odds'));
  });

  test('missing units is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ units: '' }), 'player-prop');
    assert.ok(fields.includes('units'));
  });

  test('units below 0.5 is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ units: '0.4' }), 'player-prop');
    assert.ok(fields.includes('units'));
  });

  test('units above 5.0 is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ units: '5.1' }), 'player-prop');
    assert.ok(fields.includes('units'));
  });

  test('units at 0.5 boundary is accepted', () => {
    const fields = blockingFields(validPlayerProp({ units: '0.5' }), 'player-prop');
    assert.ok(!fields.includes('units'));
  });

  test('units at 5.0 boundary is accepted', () => {
    const fields = blockingFields(validPlayerProp({ units: '5.0' }), 'player-prop');
    assert.ok(!fields.includes('units'));
  });

  test('non-numeric units is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ units: 'abc' }), 'player-prop');
    assert.ok(fields.includes('units'));
  });
});

// --- Warn-only fields ---

describe('warnings', () => {
  test('missing sportsbook produces a warning', () => {
    const fields = warningFields(validPlayerProp({ sportsbook: '' }), 'player-prop');
    assert.ok(fields.includes('sportsbook'));
  });

  test('sportsbook warning does not block submission', () => {
    const fields = blockingFields(validPlayerProp({ sportsbook: '' }), 'player-prop');
    assert.ok(!fields.includes('sportsbook'));
  });

  test('provided sportsbook produces no warning', () => {
    const fields = warningFields(validPlayerProp({ sportsbook: 'DraftKings' }), 'player-prop');
    assert.ok(!fields.includes('sportsbook'));
  });
});

// --- Player Prop conditional fields ---

describe('player-prop conditional fields', () => {
  test('complete player prop has no blocking errors', () => {
    const errors = getBlockingErrors(validateSmartFormSubmission(validPlayerProp(), 'player-prop', catalog));
    assert.equal(errors.length, 0);
  });

  test('missing player is blocking', () => {
    const fields = blockingFields(validPlayerProp({ player: '' }), 'player-prop');
    assert.ok(fields.includes('player'));
  });

  test('missing matchup is blocking', () => {
    const fields = blockingFields(validPlayerProp({ matchup: '' }), 'player-prop');
    assert.ok(fields.includes('matchup'));
  });

  test('missing statType is blocking', () => {
    const fields = blockingFields(validPlayerProp({ statType: '' }), 'player-prop');
    assert.ok(fields.includes('statType'));
  });

  test('missing overUnder is blocking', () => {
    const fields = blockingFields(validPlayerProp({ overUnder: '' }), 'player-prop');
    assert.ok(fields.includes('overUnder'));
  });

  test('invalid overUnder value is blocking', () => {
    const fields = blockingFields(validPlayerProp({ overUnder: 'Push' }), 'player-prop');
    assert.ok(fields.includes('overUnder'));
  });

  test('missing line is blocking', () => {
    const fields = blockingFields(validPlayerProp({ line: '' }), 'player-prop');
    assert.ok(fields.includes('line'));
  });

  test('non-numeric line is blocking', () => {
    const fields = blockingFields(validPlayerProp({ line: 'abc' }), 'player-prop');
    assert.ok(fields.includes('line'));
  });
});

// --- Moneyline conditional fields ---

describe('moneyline conditional fields', () => {
  test('complete moneyline has no blocking errors', () => {
    const errors = getBlockingErrors(validateSmartFormSubmission(validMoneyline(), 'moneyline', catalog));
    assert.equal(errors.length, 0);
  });

  test('missing matchup is blocking', () => {
    const fields = blockingFields(validMoneyline({ matchup: '' }), 'moneyline');
    assert.ok(fields.includes('matchup'));
  });

  test('missing team is blocking', () => {
    const fields = blockingFields(validMoneyline({ team: '' }), 'moneyline');
    assert.ok(fields.includes('team'));
  });
});

// --- Spread conditional fields ---

describe('spread conditional fields', () => {
  test('complete spread has no blocking errors', () => {
    const errors = getBlockingErrors(validateSmartFormSubmission(validSpread(), 'spread', catalog));
    assert.equal(errors.length, 0);
  });

  test('missing matchup is blocking', () => {
    const fields = blockingFields(validSpread({ matchup: '' }), 'spread');
    assert.ok(fields.includes('matchup'));
  });

  test('missing team is blocking', () => {
    const fields = blockingFields(validSpread({ team: '' }), 'spread');
    assert.ok(fields.includes('team'));
  });

  test('missing line is blocking', () => {
    const fields = blockingFields(validSpread({ line: '' }), 'spread');
    assert.ok(fields.includes('line'));
  });
});

// --- Total conditional fields ---

describe('total conditional fields', () => {
  test('complete total has no blocking errors', () => {
    const errors = getBlockingErrors(validateSmartFormSubmission(validTotal(), 'total', catalog));
    assert.equal(errors.length, 0);
  });

  test('missing matchup is blocking', () => {
    const fields = blockingFields(validTotal({ matchup: '' }), 'total');
    assert.ok(fields.includes('matchup'));
  });

  test('missing overUnder is blocking', () => {
    const fields = blockingFields(validTotal({ overUnder: '' }), 'total');
    assert.ok(fields.includes('overUnder'));
  });

  test('missing line is blocking', () => {
    const fields = blockingFields(validTotal({ line: '' }), 'total');
    assert.ok(fields.includes('line'));
  });
});

// --- Team Total conditional fields ---

describe('team-total conditional fields', () => {
  test('complete team total has no blocking errors', () => {
    const errors = getBlockingErrors(validateSmartFormSubmission(validTeamTotal(), 'team-total', catalog));
    assert.equal(errors.length, 0);
  });

  test('missing matchup is blocking', () => {
    const fields = blockingFields(validTeamTotal({ matchup: '' }), 'team-total');
    assert.ok(fields.includes('matchup'));
  });

  test('missing team is blocking', () => {
    const fields = blockingFields(validTeamTotal({ team: '' }), 'team-total');
    assert.ok(fields.includes('team'));
  });

  test('missing overUnder is blocking', () => {
    const fields = blockingFields(validTeamTotal({ overUnder: '' }), 'team-total');
    assert.ok(fields.includes('overUnder'));
  });

  test('missing line is blocking', () => {
    const fields = blockingFields(validTeamTotal({ line: '' }), 'team-total');
    assert.ok(fields.includes('line'));
  });
});

// --- Cross-market: fields NOT required for certain types ---

describe('cross-market field requirements', () => {
  test('moneyline does not require player, statType, overUnder, or line', () => {
    const fields = blockingFields(validMoneyline(), 'moneyline');
    assert.ok(!fields.includes('player'));
    assert.ok(!fields.includes('statType'));
    assert.ok(!fields.includes('overUnder'));
    assert.ok(!fields.includes('line'));
  });

  test('total does not require player, statType, or team', () => {
    const fields = blockingFields(validTotal(), 'total');
    assert.ok(!fields.includes('player'));
    assert.ok(!fields.includes('statType'));
    assert.ok(!fields.includes('team'));
  });

  test('spread does not require overUnder', () => {
    const fields = blockingFields(validSpread(), 'spread');
    assert.ok(!fields.includes('overUnder'));
  });
});

// --- Reference-data enforcement ---

describe('reference-data enforcement', () => {
  test('unknown capper is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ capper: 'unknown_capper' }), 'player-prop');
    assert.ok(fields.includes('capper'));
  });

  test('known capper is accepted', () => {
    const fields = blockingFields(validPlayerProp({ capper: 'griff843' }), 'player-prop');
    assert.ok(!fields.includes('capper'));
  });

  test('unknown sport is a blocking error', () => {
    const fields = blockingFields(validPlayerProp({ sport: 'Cricket' }), 'player-prop');
    assert.ok(fields.includes('sport'));
  });

  test('known sport is accepted', () => {
    const fields = blockingFields(validPlayerProp({ sport: 'NBA' }), 'player-prop');
    assert.ok(!fields.includes('sport'));
  });

  test('stat type wrong for sport is a blocking error', () => {
    // Points is an NBA stat type, not NHL
    const fields = blockingFields(validPlayerProp({ sport: 'NHL', statType: 'Rebounds' }), 'player-prop');
    assert.ok(fields.includes('statType'));
  });

  test('stat type correct for sport is accepted', () => {
    const fields = blockingFields(validPlayerProp({ sport: 'NBA', statType: 'Points' }), 'player-prop');
    assert.ok(!fields.includes('statType'));
  });

  test('team not in sport produces a warning', () => {
    const fields = warningFields(validMoneyline({ team: 'FakeTeam' }), 'moneyline');
    assert.ok(fields.includes('team'));
  });

  test('team in sport produces no warning', () => {
    const fields = warningFields(validMoneyline({ team: 'Knicks' }), 'moneyline');
    assert.ok(!fields.includes('team'));
  });

  test('unknown sportsbook produces a warning (not error)', () => {
    const warnings = warningFields(validPlayerProp({ sportsbook: 'unknownbook' }), 'player-prop');
    assert.ok(warnings.includes('sportsbook'));
    const errors = blockingFields(validPlayerProp({ sportsbook: 'unknownbook' }), 'player-prop');
    assert.ok(!errors.includes('sportsbook'));
  });

  test('known sportsbook by ID produces no warning', () => {
    const warnings = warningFields(validPlayerProp({ sportsbook: 'draftkings' }), 'player-prop');
    assert.ok(!warnings.includes('sportsbook'));
  });
});

// --- Tightened numeric guardrails ---

describe('numeric guardrails', () => {
  test('American odds must be integer (rejects 110.5)', () => {
    const fields = blockingFields(validPlayerProp({ odds: '110.5', oddsFormat: 'American' }), 'player-prop');
    assert.ok(fields.includes('odds'));
  });

  test('American odds +50 is invalid (below +100)', () => {
    const fields = blockingFields(validPlayerProp({ odds: '50', oddsFormat: 'American' }), 'player-prop');
    assert.ok(fields.includes('odds'));
  });

  test('American odds -50 is invalid (above -100)', () => {
    const fields = blockingFields(validPlayerProp({ odds: '-50', oddsFormat: 'American' }), 'player-prop');
    assert.ok(fields.includes('odds'));
  });

  test('American odds +100 is valid', () => {
    const fields = blockingFields(validPlayerProp({ odds: '100', oddsFormat: 'American' }), 'player-prop');
    assert.ok(!fields.includes('odds'));
  });

  test('American odds -100 is valid', () => {
    const fields = blockingFields(validPlayerProp({ odds: '-100', oddsFormat: 'American' }), 'player-prop');
    assert.ok(!fields.includes('odds'));
  });

  test('American odds exceeding +50000 is invalid', () => {
    const fields = blockingFields(validPlayerProp({ odds: '50001', oddsFormat: 'American' }), 'player-prop');
    assert.ok(fields.includes('odds'));
  });

  test('American odds -50000 is valid', () => {
    const fields = blockingFields(validPlayerProp({ odds: '-50000', oddsFormat: 'American' }), 'player-prop');
    assert.ok(!fields.includes('odds'));
  });

  test('Decimal odds below 1.01 is invalid', () => {
    const fields = blockingFields(validPlayerProp({ odds: '1.00', oddsFormat: 'Decimal' }), 'player-prop');
    assert.ok(fields.includes('odds'));
  });

  test('Decimal odds above 501.00 is invalid', () => {
    const fields = blockingFields(validPlayerProp({ odds: '502', oddsFormat: 'Decimal' }), 'player-prop');
    assert.ok(fields.includes('odds'));
  });

  test('Decimal odds 2.50 is valid', () => {
    const fields = blockingFields(validPlayerProp({ odds: '2.50', oddsFormat: 'Decimal' }), 'player-prop');
    assert.ok(!fields.includes('odds'));
  });

  test('line exceeding 999.5 is invalid', () => {
    const fields = blockingFields(validPlayerProp({ line: '1000' }), 'player-prop');
    assert.ok(fields.includes('line'));
  });

  test('line below -999.5 is invalid', () => {
    const fields = blockingFields(validPlayerProp({ line: '-1000' }), 'player-prop');
    assert.ok(fields.includes('line'));
  });

  test('line at 999.5 is valid', () => {
    const fields = blockingFields(validPlayerProp({ line: '999.5' }), 'player-prop');
    assert.ok(!fields.includes('line'));
  });

  test('line at -999.5 is valid', () => {
    const fields = blockingFields(validPlayerProp({ line: '-999.5' }), 'player-prop');
    assert.ok(!fields.includes('line'));
  });
});
