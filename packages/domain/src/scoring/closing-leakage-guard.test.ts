import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MLB_WEIGHTS } from './mlb.js';
import { NBA_WEIGHTS } from './nba.js';
import { NFL_WEIGHTS } from './nfl.js';
import { NHL_WEIGHTS } from './nhl.js';
import { CORE_WEIGHT_KEYS } from './types.js';

// UTV2-727: Leakage guard — scoring weight configs must never contain actual
// closing-line data. closingLineValue and closingLinePrediction are fractional
// model parameter weights (0-1), not raw odds or point-spread values.

const ALL_SPORT_WEIGHTS = [
  { sport: 'MLB', weights: MLB_WEIGHTS },
  { sport: 'NBA', weights: NBA_WEIGHTS },
  { sport: 'NFL', weights: NFL_WEIGHTS },
  { sport: 'NHL', weights: NHL_WEIGHTS },
] as const;

describe('closing-leakage-guard', () => {
  describe('closingLineValue weight is a fractional parameter, not a raw line', () => {
    for (const { sport, weights } of ALL_SPORT_WEIGHTS) {
      it(`${sport}: closingLineValue is between 0 and 1`, () => {
        const v = weights.closingLineValue;
        assert.ok(
          typeof v === 'number' && v >= 0 && v <= 1,
          `${sport}.closingLineValue=${v} must be a fractional weight in [0,1], not a raw line value`,
        );
      });
    }
  });

  describe('closingLinePrediction weight is a fractional parameter, not a raw line', () => {
    for (const { sport, weights } of ALL_SPORT_WEIGHTS) {
      it(`${sport}: closingLinePrediction is between 0 and 1`, () => {
        const v = weights.closingLinePrediction;
        assert.ok(
          typeof v === 'number' && v >= 0 && v <= 1,
          `${sport}.closingLinePrediction=${v} must be a fractional weight in [0,1], not a raw line value`,
        );
      });
    }
  });

  describe('weight objects do not contain DB column names', () => {
    for (const { sport, weights } of ALL_SPORT_WEIGHTS) {
      it(`${sport}: no "closing_line" snake_case property (would indicate DB row leakage)`, () => {
        assert.ok(
          !Object.prototype.hasOwnProperty.call(weights, 'closing_line'),
          `${sport} weight object must not have a "closing_line" property — that is a DB column name and would indicate scoring inputs leaked with closing data`,
        );
      });

      it(`${sport}: no "closing_over_odds" snake_case property`, () => {
        assert.ok(!Object.prototype.hasOwnProperty.call(weights, 'closing_over_odds'));
      });

      it(`${sport}: no "closing_under_odds" snake_case property`, () => {
        assert.ok(!Object.prototype.hasOwnProperty.call(weights, 'closing_under_odds'));
      });
    }
  });

  describe('CORE_WEIGHT_KEYS includes closing weight keys', () => {
    it('contains closingLineValue', () => {
      assert.ok(
        CORE_WEIGHT_KEYS.includes('closingLineValue'),
        'CORE_WEIGHT_KEYS must include "closingLineValue"',
      );
    });

    it('contains closingLinePrediction', () => {
      assert.ok(
        CORE_WEIGHT_KEYS.includes('closingLinePrediction'),
        'CORE_WEIGHT_KEYS must include "closingLinePrediction"',
      );
    });
  });
});
