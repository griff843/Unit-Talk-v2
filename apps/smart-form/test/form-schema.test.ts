/**
 * Tests for the live Next.js smart form schema (lib/form-schema.ts).
 * This is the validation layer for the live browser submit surface.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { betFormSchema } from '../lib/form-schema.ts';

// Minimal valid player-prop
function validProp(overrides: Record<string, unknown> = {}) {
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

// Minimal valid moneyline
function validMoneyline(overrides: Record<string, unknown> = {}) {
  return {
    sport: 'NBA',
    marketType: 'moneyline',
    eventName: 'Knicks vs Heat',
    team: 'Knicks',
    sportsbook: 'DraftKings',
    odds: -110,
    units: 1.0,
    capperConviction: 8,
    capper: 'griff843',
    gameDate: '2026-03-22',
    ...overrides,
  };
}

function parse(data: Record<string, unknown>) {
  return betFormSchema.safeParse(data);
}

function passes(data: Record<string, unknown>): boolean {
  return parse(data).success;
}

function errorFields(data: Record<string, unknown>): string[] {
  const result = parse(data);
  if (result.success) return [];
  return result.error.issues.map((i) => String(i.path[0] ?? 'root'));
}

// --- Happy path ---

describe('valid submissions parse successfully', () => {
  test('valid player-prop parses', () => {
    assert.ok(passes(validProp()));
  });

  test('valid moneyline parses', () => {
    assert.ok(passes(validMoneyline()));
  });

  test('valid spread parses', () => {
    assert.ok(
      passes({
        sport: 'NBA',
        marketType: 'spread',
        eventName: 'Knicks vs Heat',
        team: 'Knicks',
        line: -3.5,
        sportsbook: 'FanDuel',
        odds: -110,
        units: 1.0,
        capperConviction: 8,
        capper: 'griff843',
        gameDate: '2026-03-22',
      }),
    );
  });

  test('valid total parses', () => {
    assert.ok(
      passes({
        sport: 'NBA',
        marketType: 'total',
        eventName: 'Knicks vs Heat',
        direction: 'over',
        line: 215.5,
        sportsbook: 'BetMGM',
        odds: -110,
        units: 2.0,
        capperConviction: 8,
        capper: 'griff843',
        gameDate: '2026-03-22',
      }),
    );
  });

  test('valid team-total parses', () => {
    assert.ok(
      passes({
        sport: 'NBA',
        marketType: 'team-total',
        eventName: 'Knicks vs Heat',
        team: 'Knicks',
        direction: 'over',
        line: 108.5,
        sportsbook: 'Caesars',
        odds: -115,
        units: 1.0,
        capperConviction: 8,
        capper: 'griff843',
        gameDate: '2026-03-22',
      }),
    );
  });
});

// --- Units contract guardrail ---

describe('units guardrail (contract: 0.5 - 5.0)', () => {
  test('units 0.5 is accepted', () => {
    assert.ok(passes(validProp({ units: 0.5 })));
  });

  test('units 5.0 is accepted', () => {
    assert.ok(passes(validProp({ units: 5.0 })));
  });

  test('units 1.0 is accepted', () => {
    assert.ok(passes(validProp({ units: 1.0 })));
  });

  test('units 2.5 is accepted', () => {
    assert.ok(passes(validProp({ units: 2.5 })));
  });

  test('units 0.4 is rejected (below 0.5)', () => {
    const fields = errorFields(validProp({ units: 0.4 }));
    assert.ok(fields.includes('units'), `Expected units error, got: ${fields.join(', ')}`);
  });

  test('units 0 is rejected', () => {
    const fields = errorFields(validProp({ units: 0 }));
    assert.ok(fields.includes('units'));
  });

  test('units 5.1 is rejected (above 5.0)', () => {
    const fields = errorFields(validProp({ units: 5.1 }));
    assert.ok(fields.includes('units'), `Expected units error, got: ${fields.join(', ')}`);
  });

  test('units 10 is rejected', () => {
    const fields = errorFields(validProp({ units: 10 }));
    assert.ok(fields.includes('units'));
  });

  test('units missing is rejected', () => {
    const data = { ...validProp() };
    delete (data as Record<string, unknown>)['units'];
    const fields = errorFields(data);
    assert.ok(fields.includes('units'));
  });
});

describe('capper conviction guardrail (contract: 1 - 10 integer, required)', () => {
  test('conviction 1 is accepted', () => {
    assert.ok(passes(validProp({ capperConviction: 1 })));
  });

  test('conviction 10 is accepted', () => {
    assert.ok(passes(validProp({ capperConviction: 10 })));
  });

  test('conviction missing is rejected', () => {
    const data = { ...validProp() };
    delete (data as Record<string, unknown>)['capperConviction'];
    const fields = errorFields(data);
    assert.ok(fields.includes('capperConviction'));
  });

  test('conviction below 1 is rejected', () => {
    const fields = errorFields(validProp({ capperConviction: 0 }));
    assert.ok(fields.includes('capperConviction'));
  });

  test('conviction above 10 is rejected', () => {
    const fields = errorFields(validProp({ capperConviction: 11 }));
    assert.ok(fields.includes('capperConviction'));
  });

  test('non-integer conviction is rejected', () => {
    const fields = errorFields(validProp({ capperConviction: 7.5 }));
    assert.ok(fields.includes('capperConviction'));
  });
});

// --- Odds guardrail ---

describe('odds guardrail', () => {
  test('odds -110 is accepted', () => {
    assert.ok(passes(validProp({ odds: -110 })));
  });

  test('odds +150 is accepted', () => {
    assert.ok(passes(validProp({ odds: 150 })));
  });

  test('odds -100 is accepted', () => {
    assert.ok(passes(validProp({ odds: -100 })));
  });

  test('odds +100 is accepted', () => {
    assert.ok(passes(validProp({ odds: 100 })));
  });

  test('odds 0 is rejected', () => {
    const fields = errorFields(validProp({ odds: 0 }));
    assert.ok(fields.includes('odds'));
  });

  test('odds +50 is rejected (between -99 and +99)', () => {
    const fields = errorFields(validProp({ odds: 50 }));
    assert.ok(fields.includes('odds'));
  });

  test('odds -50 is rejected', () => {
    const fields = errorFields(validProp({ odds: -50 }));
    assert.ok(fields.includes('odds'));
  });

  test('non-integer odds is rejected', () => {
    const fields = errorFields(validProp({ odds: -110.5 }));
    assert.ok(fields.includes('odds'));
  });
});

// --- Universal required fields ---

describe('universal required fields', () => {
  test('missing sport is rejected', () => {
    const fields = errorFields(validProp({ sport: '' }));
    assert.ok(fields.includes('sport'));
  });

  test('missing marketType is rejected', () => {
    const data = { ...validProp() };
    delete (data as Record<string, unknown>)['marketType'];
    const fields = errorFields(data);
    assert.ok(fields.includes('marketType'));
  });

  test('invalid marketType is rejected', () => {
    const fields = errorFields(validProp({ marketType: 'parlay' }));
    assert.ok(fields.includes('marketType'));
  });

  test('missing eventName is rejected', () => {
    const fields = errorFields(validProp({ eventName: '' }));
    assert.ok(fields.includes('eventName'));
  });

  test('sportsbook is optional (warn-only per contract)', () => {
    // contract: sportsbook is warn-only, not a blocking validation field
    assert.ok(passes(validProp({ sportsbook: '' })));
    assert.ok(passes(validProp({ sportsbook: undefined })));
  });

  test('capper is optional (identity derived from bearer token on server, UTV2-658)', () => {
    // capper field is no longer required — the API sets it from the JWT capperId claim
    assert.ok(passes(validProp({ capper: '' })));
    assert.ok(passes(validProp({ capper: undefined })));
  });

  test('missing gameDate is rejected', () => {
    const fields = errorFields(validProp({ gameDate: '' }));
    assert.ok(fields.includes('gameDate'));
  });
});

// --- Player-prop conditional fields ---

describe('player-prop conditional fields', () => {
  test('missing playerName is blocking for player-prop', () => {
    const fields = errorFields(validProp({ playerName: '' }));
    assert.ok(fields.includes('playerName'));
  });

  test('missing statType is blocking for player-prop', () => {
    const fields = errorFields(validProp({ statType: '' }));
    assert.ok(fields.includes('statType'));
  });

  test('missing direction is blocking for player-prop', () => {
    const data = { ...validProp() };
    delete (data as Record<string, unknown>)['direction'];
    const fields = errorFields(data);
    assert.ok(fields.includes('direction'));
  });

  test('invalid direction is rejected', () => {
    const fields = errorFields(validProp({ direction: 'push' }));
    assert.ok(fields.includes('direction'));
  });

  test('missing line is blocking for player-prop', () => {
    const data = { ...validProp() };
    delete (data as Record<string, unknown>)['line'];
    const fields = errorFields(data);
    assert.ok(fields.includes('line'));
  });

  test('moneyline does not require playerName', () => {
    const fields = errorFields(validMoneyline());
    assert.ok(!fields.includes('playerName'));
  });

  test('moneyline does not require statType', () => {
    const fields = errorFields(validMoneyline());
    assert.ok(!fields.includes('statType'));
  });

  test('moneyline does not require line', () => {
    const fields = errorFields(validMoneyline());
    assert.ok(!fields.includes('line'));
  });
});

// --- source is not a form field (verified at payload level) ---

describe('payload source identity', () => {
  test('source field is not a schema field (set at payload build time)', () => {
    // betFormSchema does not include a `source` field — source is set in
    // buildSubmissionPayload. This test confirms the schema has no source field.
    const result = betFormSchema.safeParse(validProp());
    assert.ok(result.success);
    assert.ok(!('source' in result.data));
  });
});

// --- Odds upper cap ---

describe('odds upper cap (contract: ±100 to ±50000)', () => {
  test('odds +50000 is accepted (boundary)', () => {
    assert.ok(passes(validProp({ odds: 50000 })));
  });

  test('odds -50000 is accepted (boundary)', () => {
    assert.ok(passes(validProp({ odds: -50000 })));
  });

  test('odds +50001 is rejected (above cap)', () => {
    const fields = errorFields(validProp({ odds: 50001 }));
    assert.ok(fields.includes('odds'), `Expected odds error, got: ${fields.join(', ')}`);
  });

  test('odds -50001 is rejected (above cap)', () => {
    const fields = errorFields(validProp({ odds: -50001 }));
    assert.ok(fields.includes('odds'), `Expected odds error, got: ${fields.join(', ')}`);
  });
});

// --- Line bounds ---

describe('line bounds (contract: ±999.5 where required)', () => {
  test('line 999.5 is accepted for player-prop', () => {
    assert.ok(passes(validProp({ line: 999.5 })));
  });

  test('line -999.5 is accepted for player-prop', () => {
    assert.ok(passes(validProp({ line: -999.5 })));
  });

  test('line 1000 is rejected for player-prop', () => {
    const fields = errorFields(validProp({ line: 1000 }));
    assert.ok(fields.includes('line'), `Expected line error, got: ${fields.join(', ')}`);
  });

  test('line -1000 is rejected for player-prop', () => {
    const fields = errorFields(validProp({ line: -1000 }));
    assert.ok(fields.includes('line'), `Expected line error, got: ${fields.join(', ')}`);
  });
});

// --- Spread conditional fields ---

describe('spread conditional fields', () => {
  function validSpread(overrides: Record<string, unknown> = {}) {
    return {
      sport: 'NBA',
      marketType: 'spread',
      eventName: 'Knicks vs Heat',
      team: 'Knicks',
      line: -3.5,
      sportsbook: 'FanDuel',
      odds: -110,
      units: 1.0,
      capperConviction: 8,
      capper: 'griff843',
      gameDate: '2026-03-22',
      ...overrides,
    };
  }

  test('spread requires team', () => {
    const fields = errorFields(validSpread({ team: '' }));
    assert.ok(fields.includes('team'), `Expected team error, got: ${fields.join(', ')}`);
  });

  test('spread requires line', () => {
    const data = { ...validSpread() };
    delete (data as Record<string, unknown>)['line'];
    const fields = errorFields(data);
    assert.ok(fields.includes('line'), `Expected line error, got: ${fields.join(', ')}`);
  });

  test('spread line bound enforced (1000 rejected)', () => {
    const fields = errorFields(validSpread({ line: 1000 }));
    assert.ok(fields.includes('line'), `Expected line error, got: ${fields.join(', ')}`);
  });
});

// --- Total conditional fields ---

describe('total conditional fields', () => {
  function validTotal(overrides: Record<string, unknown> = {}) {
    return {
      sport: 'NBA',
      marketType: 'total',
      eventName: 'Knicks vs Heat',
      direction: 'over',
      line: 215.5,
      sportsbook: 'BetMGM',
      odds: -110,
      units: 1.0,
      capperConviction: 8,
      capper: 'griff843',
      gameDate: '2026-03-22',
      ...overrides,
    };
  }

  test('total requires direction', () => {
    const data = { ...validTotal() };
    delete (data as Record<string, unknown>)['direction'];
    const fields = errorFields(data);
    assert.ok(fields.includes('direction'), `Expected direction error, got: ${fields.join(', ')}`);
  });

  test('total requires line', () => {
    const data = { ...validTotal() };
    delete (data as Record<string, unknown>)['line'];
    const fields = errorFields(data);
    assert.ok(fields.includes('line'), `Expected line error, got: ${fields.join(', ')}`);
  });
});

// --- Team-total conditional fields ---

describe('team-total conditional fields', () => {
  function validTeamTotal(overrides: Record<string, unknown> = {}) {
    return {
      sport: 'NBA',
      marketType: 'team-total',
      eventName: 'Knicks vs Heat',
      team: 'Knicks',
      direction: 'over',
      line: 108.5,
      sportsbook: 'Caesars',
      odds: -115,
      units: 1.0,
      capperConviction: 8,
      capper: 'griff843',
      gameDate: '2026-03-22',
      ...overrides,
    };
  }

  test('team-total requires team', () => {
    const fields = errorFields(validTeamTotal({ team: '' }));
    assert.ok(fields.includes('team'), `Expected team error, got: ${fields.join(', ')}`);
  });

  test('team-total requires direction', () => {
    const data = { ...validTeamTotal() };
    delete (data as Record<string, unknown>)['direction'];
    const fields = errorFields(data);
    assert.ok(fields.includes('direction'), `Expected direction error, got: ${fields.join(', ')}`);
  });

  test('team-total requires line', () => {
    const data = { ...validTeamTotal() };
    delete (data as Record<string, unknown>)['line'];
    const fields = errorFields(data);
    assert.ok(fields.includes('line'), `Expected line error, got: ${fields.join(', ')}`);
  });
});

// --- Moneyline conditional fields ---

describe('moneyline conditional fields', () => {
  test('moneyline requires team', () => {
    const fields = errorFields(validMoneyline({ team: '' }));
    assert.ok(fields.includes('team'), `Expected team error, got: ${fields.join(', ')}`);
  });
});
