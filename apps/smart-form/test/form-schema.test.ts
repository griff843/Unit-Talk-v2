/**
 * Tests for the live Next.js smart form schema (lib/form-schema.ts).
 * This is the validation layer for the live browser submit surface.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';
import {
  betFormSchema,
  clampUnits,
  UNITS_MAX,
  UNITS_MIN,
  UNITS_STEP,
} from '../lib/form-schema.ts';

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

  test('valid 1st-half spread parses with spread requirements', () => {
    assert.ok(
      passes({
        sport: 'NBA',
        marketType: '1h_spread',
        eventName: 'Knicks vs Heat',
        team: 'Knicks',
        sportsbook: 'FanDuel',
        line: -4.5,
        odds: -110,
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

  test('period spread also requires team and line', () => {
    const missingTeam = errorFields(validSpread({ marketType: '1h_spread', team: '' }));
    const missingLine = errorFields(validSpread({ marketType: '1h_spread', line: undefined }));

    assert.ok(missingTeam.includes('team'), `Expected team error, got: ${missingTeam.join(', ')}`);
    assert.ok(missingLine.includes('line'), `Expected line error, got: ${missingLine.join(', ')}`);
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

  test('period total also requires direction and line', () => {
    const missingDirection = errorFields(validTotal({ marketType: '1q_total_ou', direction: undefined }));
    const missingLine = errorFields(validTotal({ marketType: '1q_total_ou', line: undefined }));

    assert.ok(missingDirection.includes('direction'), `Expected direction error, got: ${missingDirection.join(', ')}`);
    assert.ok(missingLine.includes('line'), `Expected line error, got: ${missingLine.join(', ')}`);
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

  test('period moneyline also requires team', () => {
    const fields = errorFields(validMoneyline({ marketType: '1p_moneyline', team: '' }));
    assert.ok(fields.includes('team'), `Expected team error, got: ${fields.join(', ')}`);
  });
});

// --- Units guardrail (UTV2-1855) ---
//
// The units stepper in BetForm used to carry its own literals, and the increment button's was 10
// while the schema caps at 5.0, so the operator could reach a value the resolver then rejected.
// These assertions are driven from the schema itself rather than from a repeated literal, so a
// future bound change cannot silently reintroduce the drift.

describe('units guardrail', () => {
  test('clampUnits never produces a value the schema rejects', () => {
    // Sweep well past both bounds, on and off the step grid.
    for (let raw = -3; raw <= 12.0001; raw += 0.1) {
      const clamped = clampUnits(Number(raw.toFixed(4)));
      const result = betFormSchema.safeParse(validMoneyline({ units: clamped }));
      assert.equal(
        result.success,
        true,
        `clampUnits(${raw.toFixed(2)}) = ${clamped} was rejected by the schema`,
      );
    }
  });

  test('repeated increments from the default settle at the schema maximum', () => {
    let value = 1;
    for (let i = 0; i < 40; i++) {
      value = clampUnits(value + UNITS_STEP);
    }
    assert.equal(value, UNITS_MAX);
    assert.equal(betFormSchema.safeParse(validMoneyline({ units: value })).success, true);
  });

  test('repeated decrements from the default settle at the schema minimum', () => {
    let value = 1;
    for (let i = 0; i < 40; i++) {
      value = clampUnits(value - UNITS_STEP);
    }
    assert.equal(value, UNITS_MIN);
    assert.equal(betFormSchema.safeParse(validMoneyline({ units: value })).success, true);
  });

  test('the schema itself still refuses one step beyond either bound', () => {
    assert.equal(betFormSchema.safeParse(validMoneyline({ units: UNITS_MAX + UNITS_STEP })).success, false);
    assert.equal(betFormSchema.safeParse(validMoneyline({ units: UNITS_MIN - UNITS_STEP })).success, false);
  });

  test('non-finite input falls back to the minimum rather than NaN or Infinity', () => {
    // Deliberately the minimum, not the maximum: a non-finite stake is a broken input, and the
    // conservative resolution for a stake field is the smallest legal value, never the largest.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(clampUnits(bad), UNITS_MIN);
      assert.equal(betFormSchema.safeParse(validMoneyline({ units: clampUnits(bad) })).success, true);
    }
  });
});

// The two units stepper buttons live in JSX and cannot be driven by a unit test, so this asserts
// the property that actually regressed: that they route through the shared clamp rather than
// carrying their own literal bound. Before UTV2-1855 the increment handler read
// `Math.min(10, ...)` while the schema capped units at 5.0.

describe('units stepper wiring', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../app/submit/components/BetForm.tsx', import.meta.url)),
    'utf8',
  );

  test('every units stepper handler routes through clampUnits', () => {
    const handlers = source
      .split('\n')
      .filter((line) => line.includes('field.onChange(') && line.includes('UNITS_STEP'));
    assert.equal(handlers.length, 2, `Expected 2 units stepper handlers, found ${handlers.length}`);
    for (const handler of handlers) {
      assert.ok(
        handler.includes('clampUnits('),
        `Units stepper handler does not use clampUnits: ${handler.trim()}`,
      );
    }
  });

  test('no units stepper handler carries its own numeric bound', () => {
    const offenders = source
      .split('\n')
      .filter(
        (line) =>
          line.includes('field.onChange(') &&
          /Math\.(?:min|max)\(\s*-?\d/u.test(line),
      );
    assert.deepEqual(offenders, [], `Numeric clamp literal in an onChange handler: ${offenders.join(' | ')}`);
  });
});
