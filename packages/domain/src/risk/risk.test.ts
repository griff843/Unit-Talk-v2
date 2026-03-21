import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeKellySize,
  computeKellyFraction,
  americanToDecimal,
  DEFAULT_BANKROLL_CONFIG,
} from './kelly-sizer.js';

import type { BankrollConfig } from './kelly-sizer.js';

// ============================================================================
// americanToDecimal
// ============================================================================

describe('americanToDecimal', () => {
  it('converts positive American odds correctly', () => {
    assert.equal(americanToDecimal(150), 2.5);
    assert.equal(americanToDecimal(100), 2.0);
    assert.equal(americanToDecimal(200), 3.0);
  });

  it('converts negative American odds correctly', () => {
    assert.ok(Math.abs(americanToDecimal(-110) - 1.909) < 0.001);
    assert.equal(americanToDecimal(-200), 1.5);
    assert.equal(americanToDecimal(-100), 2.0);
  });

  it('handles even odds (0) gracefully', () => {
    assert.equal(americanToDecimal(0), 1);
  });
});

// ============================================================================
// computeKellyFraction — pure fraction without bankroll
// ============================================================================

describe('computeKellyFraction', () => {
  it('computes correct fractional Kelly for standard inputs', () => {
    // 55% win prob, +100 odds (decimal 2.0), 25% Kelly
    // Raw Kelly: (1*0.55 - 0.45) / 1 = 0.10
    // Fractional: 0.10 * 0.25 = 0.025
    const result = computeKellyFraction(0.55, 2.0, 0.25, 0.05);
    assert.ok(Math.abs(result - 0.025) < 0.0001);
  });

  it('returns 0 for no-edge scenarios', () => {
    // 45% win prob, +100 odds → negative Kelly
    assert.equal(computeKellyFraction(0.45, 2.0), 0);
  });

  it('returns 0 for exactly even edge', () => {
    // 50% win prob, +100 odds → Kelly = 0
    assert.equal(computeKellyFraction(0.5, 2.0), 0);
  });

  it('caps at max fraction', () => {
    // 90% win prob, +100 odds → very high Kelly
    // Raw: (1*0.90 - 0.10) / 1 = 0.80
    // Fractional: 0.80 * 0.25 = 0.20
    // But max_fraction = 0.05 → capped at 0.05
    const result = computeKellyFraction(0.9, 2.0, 0.25, 0.05);
    assert.equal(result, 0.05);
  });

  it('returns 0 for invalid probability (0)', () => {
    assert.equal(computeKellyFraction(0, 2.0), 0);
  });

  it('returns 0 for invalid probability (1)', () => {
    assert.equal(computeKellyFraction(1, 2.0), 0);
  });

  it('returns 0 for invalid probability (negative)', () => {
    assert.equal(computeKellyFraction(-0.5, 2.0), 0);
  });

  it('returns 0 for invalid probability (> 1)', () => {
    assert.equal(computeKellyFraction(1.5, 2.0), 0);
  });

  it('returns 0 for invalid odds (1 or less)', () => {
    assert.equal(computeKellyFraction(0.55, 1.0), 0);
    assert.equal(computeKellyFraction(0.55, 0.5), 0);
  });

  it('returns 0 for NaN inputs', () => {
    assert.equal(computeKellyFraction(NaN, 2.0), 0);
    assert.equal(computeKellyFraction(0.55, NaN), 0);
  });

  it('returns 0 for Infinity inputs', () => {
    assert.equal(computeKellyFraction(Infinity, 2.0), 0);
    assert.equal(computeKellyFraction(0.55, Infinity), 0);
  });

  it('returns 0 for invalid kelly multiplier', () => {
    assert.equal(computeKellyFraction(0.55, 2.0, 0, 0.05), 0);
    assert.equal(computeKellyFraction(0.55, 2.0, -1, 0.05), 0);
    assert.equal(computeKellyFraction(0.55, 2.0, 1.5, 0.05), 0);
  });

  it('is deterministic across repeated calls', () => {
    const a = computeKellyFraction(0.58, 1.91, 0.25, 0.05);
    const b = computeKellyFraction(0.58, 1.91, 0.25, 0.05);
    const c = computeKellyFraction(0.58, 1.91, 0.25, 0.05);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  it('handles longshot odds correctly', () => {
    // 10% win prob at +900 (decimal 10.0)
    // Raw: (9*0.10 - 0.90) / 9 = 0/9 = 0
    assert.equal(computeKellyFraction(0.1, 10.0), 0);

    // 15% win prob at +900 → slight edge
    const result = computeKellyFraction(0.15, 10.0, 0.25, 0.05);
    assert.ok(result > 0);
    assert.ok(result <= 0.05);
  });

  it('handles heavy favorite correctly', () => {
    // 75% win prob at -300 (decimal 1.333)
    // b = 0.333
    // Raw: (0.333*0.75 - 0.25) / 0.333 = (0.25 - 0.25) / 0.333 = 0
    assert.equal(computeKellyFraction(0.75, 1.333), 0);
  });
});

// ============================================================================
// computeKellySize — full bankroll-aware sizing
// ============================================================================

describe('computeKellySize', () => {
  const standardBankroll: BankrollConfig = {
    total_bankroll: 1000,
    kelly_multiplier: 0.25,
    max_bet_fraction: 0.05,
    min_bet_units: 1.0,
    daily_loss_limit: 0.1,
  };

  it('computes correct sizing for standard scenario', () => {
    // 55% win prob, +100 odds, $1000 bankroll, quarter Kelly
    const result = computeKellySize(0.55, 2.0, standardBankroll);

    assert.equal(result.has_edge, true);
    assert.ok(Math.abs(result.raw_kelly - 0.1) < 0.0001);
    assert.ok(Math.abs(result.fractional_kelly - 0.025) < 0.0001);
    assert.ok(Math.abs(result.recommended_units - 25) < 1);
    assert.ok(Math.abs(result.recommended_fraction - 0.025) < 0.0001);
    assert.equal(result.capped, false);
  });

  it('caps at max bet fraction', () => {
    // 80% win prob at +100 → raw Kelly = 0.60 → frac = 0.15
    // Max bet = 5% → capped at $50
    const result = computeKellySize(0.8, 2.0, standardBankroll);

    assert.equal(result.capped, true);
    assert.equal(result.cap_reason, 'max_bet_fraction');
    assert.equal(result.recommended_fraction, 0.05);
    assert.equal(result.recommended_units, 50);
  });

  it('applies minimum bet floor', () => {
    // Tiny edge → tiny fraction → below min bet
    const tinyBankroll: BankrollConfig = {
      ...standardBankroll,
      total_bankroll: 10,
      min_bet_units: 1.0,
    };
    // 51% win prob at +100 → raw Kelly = 0.02 → frac = 0.005
    // Units = 0.005 * 10 = $0.05 → below min $1
    const result = computeKellySize(0.51, 2.0, tinyBankroll);

    if (result.has_edge) {
      assert.ok(result.recommended_units >= 1.0);
      assert.equal(result.capped, true);
      assert.equal(result.cap_reason, 'min_bet_floor');
    }
  });

  it('returns zero sizing for no edge', () => {
    const result = computeKellySize(0.45, 2.0, standardBankroll);

    assert.equal(result.has_edge, false);
    assert.ok(result.raw_kelly < 0);
    assert.equal(result.fractional_kelly, 0);
    assert.equal(result.recommended_units, 0);
    assert.equal(result.recommended_fraction, 0);
  });

  it('fail-closed on invalid bankroll (zero)', () => {
    const zeroBankroll: BankrollConfig = { ...standardBankroll, total_bankroll: 0 };
    const result = computeKellySize(0.55, 2.0, zeroBankroll);

    assert.equal(result.has_edge, false);
    assert.equal(result.recommended_units, 0);
    assert.equal(result.cap_reason, 'invalid_bankroll');
  });

  it('fail-closed on invalid bankroll (negative)', () => {
    const negBankroll: BankrollConfig = { ...standardBankroll, total_bankroll: -500 };
    const result = computeKellySize(0.55, 2.0, negBankroll);

    assert.equal(result.has_edge, false);
    assert.equal(result.recommended_units, 0);
    assert.equal(result.cap_reason, 'invalid_bankroll');
  });

  it('fail-closed on invalid probability', () => {
    const result = computeKellySize(1.5, 2.0, standardBankroll);
    assert.equal(result.has_edge, false);
    assert.equal(result.cap_reason, 'invalid_inputs');
  });

  it('fail-closed on invalid odds', () => {
    const result = computeKellySize(0.55, 0.5, standardBankroll);
    assert.equal(result.has_edge, false);
    assert.equal(result.cap_reason, 'invalid_inputs');
  });

  it('fail-closed on NaN probability', () => {
    const result = computeKellySize(NaN, 2.0, standardBankroll);
    assert.equal(result.has_edge, false);
    assert.equal(result.cap_reason, 'invalid_inputs');
  });

  it('scales linearly with bankroll', () => {
    const small = computeKellySize(0.55, 2.0, { ...standardBankroll, total_bankroll: 100 });
    const large = computeKellySize(0.55, 2.0, { ...standardBankroll, total_bankroll: 1000 });

    // Same fraction, different units
    assert.ok(Math.abs(small.recommended_fraction - large.recommended_fraction) < 0.0001);
    assert.ok(Math.abs(large.recommended_units - small.recommended_units * 10) < 1);
  });

  it('respects kelly multiplier', () => {
    const quarter = computeKellySize(0.55, 2.0, { ...standardBankroll, kelly_multiplier: 0.25 });
    const half = computeKellySize(0.55, 2.0, { ...standardBankroll, kelly_multiplier: 0.5 });

    assert.ok(Math.abs(half.fractional_kelly - quarter.fractional_kelly * 2) < 0.0001);
  });

  it('is deterministic', () => {
    const a = computeKellySize(0.58, 1.91, standardBankroll);
    const b = computeKellySize(0.58, 1.91, standardBankroll);
    assert.deepStrictEqual(a, b);
  });

  it('handles default bankroll config', () => {
    const result = computeKellySize(0.55, 2.0, DEFAULT_BANKROLL_CONFIG);
    assert.equal(result.has_edge, true);
    assert.ok(result.recommended_units > 0);
  });
});
