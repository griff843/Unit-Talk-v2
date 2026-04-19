import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeMatchupContext,
  applyMatchupContextToProbability,
} from './matchup-context.js';

describe('computeMatchupContext — opponent strength', () => {
  it('elite defense (rank 3) yields opponentStrengthFactor < 0.90', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      opponentRankVsPosition: 3,
    });
    assert.ok(
      result.factors.opponentStrengthFactor < 0.90,
      `expected < 0.90, got ${result.factors.opponentStrengthFactor}`,
    );
  });

  it('weak defense (rank 28) yields opponentStrengthFactor > 1.10', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      opponentRankVsPosition: 28,
    });
    assert.ok(
      result.factors.opponentStrengthFactor > 1.10,
      `expected > 1.10, got ${result.factors.opponentStrengthFactor}`,
    );
  });

  it('includes elite_defense reasoning for rank <= 5', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      opponentRankVsPosition: 3,
    });
    assert.ok(
      result.reasoning.some((r) => r.startsWith('elite_defense_rank_')),
    );
  });

  it('includes weak_defense reasoning for rank >= 25', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      opponentRankVsPosition: 28,
    });
    assert.ok(
      result.reasoning.some((r) => r.startsWith('weak_defense_rank_')),
    );
  });

  it('neutral rank (15) yields opponentStrengthFactor = 1.0', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      opponentRankVsPosition: 15,
    });
    assert.equal(result.factors.opponentStrengthFactor, 1.0);
  });
});

describe('computeMatchupContext — pace adjustment (NBA)', () => {
  it('high pace game (paceMultiplier 2.0) yields paceAdjustment > 1.0', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      paceMultiplier: 2.0,
    });
    assert.ok(result.factors.paceAdjustment > 1.0);
  });

  it('NBA high pace clamps to 1.10 max', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      paceMultiplier: 5.0,
    });
    assert.equal(result.factors.paceAdjustment, 1.10);
  });

  it('NBA low pace yields paceAdjustment = 0.90 (clamped)', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      paceMultiplier: 0.0,
    });
    assert.equal(result.factors.paceAdjustment, 0.90);
  });

  it('non-NBA sport ignores paceMultiplier', () => {
    const result = computeMatchupContext({
      sport: 'NFL',
      paceMultiplier: 2.0,
    });
    assert.equal(result.factors.paceAdjustment, 1.0);
  });

  it('high_pace_game in reasoning when paceMultiplier > 1.1', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      paceMultiplier: 1.5,
    });
    assert.ok(result.reasoning.includes('high_pace_game'));
  });
});

describe('computeMatchupContext — rest advantage', () => {
  it('positive rest differential increases restAdvantage', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      restDifferential: 3,
    });
    assert.ok(result.factors.restAdvantage > 0);
  });

  it('clamps restAdvantage to [-0.05, 0.05]', () => {
    const high = computeMatchupContext({ sport: 'NBA', restDifferential: 999 });
    const low = computeMatchupContext({ sport: 'NBA', restDifferential: -999 });
    assert.equal(high.factors.restAdvantage, 0.05);
    assert.equal(low.factors.restAdvantage, -0.05);
  });
});

describe('computeMatchupContext — home advantage', () => {
  it('home team gets +0.025 probability shift', () => {
    const home = computeMatchupContext({ sport: 'NBA', isHomeTeam: true });
    const away = computeMatchupContext({ sport: 'NBA', isHomeTeam: false });
    assert.equal(home.factors.homeAdvantage, 0.025);
    assert.equal(away.factors.homeAdvantage, 0.0);
  });

  it('home_court appears in reasoning', () => {
    const result = computeMatchupContext({ sport: 'NBA', isHomeTeam: true });
    assert.ok(result.reasoning.includes('home_court'));
  });
});

describe('computeMatchupContext — head-to-head', () => {
  it('dominant H2H record yields strong_h2h_advantage reasoning', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      headToHeadRecord: { wins: 8, losses: 2 },
    });
    assert.ok(result.reasoning.includes('strong_h2h_advantage'));
    assert.ok(result.factors.headToHeadFactor > 1.0);
  });

  it('poor H2H record yields poor_h2h_history reasoning', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      headToHeadRecord: { wins: 1, losses: 9 },
    });
    assert.ok(result.reasoning.includes('poor_h2h_history'));
    assert.ok(result.factors.headToHeadFactor < 1.0);
  });

  it('fewer than 3 games does not apply H2H factor', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      headToHeadRecord: { wins: 2, losses: 0 },
    });
    assert.equal(result.factors.headToHeadFactor, 1.0);
  });
});

describe('computeMatchupContext — dominantFactor', () => {
  it('returns a non-empty dominantFactor string', () => {
    const result = computeMatchupContext({
      sport: 'NBA',
      opponentRankVsPosition: 3,
      isHomeTeam: true,
    });
    assert.ok(typeof result.dominantFactor === 'string');
    assert.ok(result.dominantFactor.length > 0);
  });
});

describe('applyMatchupContextToProbability', () => {
  it('clamps result to [0.01, 0.99]', () => {
    const ctx = computeMatchupContext({
      sport: 'NBA',
      opponentRankVsPosition: 1,  // toughest defense → factor 0.86
    });
    // Start with near-zero probability
    const low = applyMatchupContextToProbability(0.001, ctx);
    assert.ok(low >= 0.01, `expected >= 0.01, got ${low}`);

    // Start with near-one probability
    const ctx2 = computeMatchupContext({
      sport: 'NBA',
      opponentRankVsPosition: 30,
      isHomeTeam: true,
      restDifferential: 100,
    });
    const high = applyMatchupContextToProbability(0.999, ctx2);
    assert.ok(high <= 0.99, `expected <= 0.99, got ${high}`);
  });

  it('home advantage adds ~0.025 to probability', () => {
    const homeCtx = computeMatchupContext({ sport: 'NBA', isHomeTeam: true });
    const awayCtx = computeMatchupContext({ sport: 'NBA', isHomeTeam: false });
    const base = 0.50;
    const homeProb = applyMatchupContextToProbability(base, homeCtx);
    const awayProb = applyMatchupContextToProbability(base, awayCtx);
    // Home should be larger by ~0.025
    assert.ok(homeProb > awayProb);
    const diff = homeProb - awayProb;
    assert.ok(Math.abs(diff - 0.025) < 0.001, `expected diff ~0.025, got ${diff}`);
  });

  it('tough defense reduces probability below base', () => {
    const ctx = computeMatchupContext({
      sport: 'NBA',
      opponentRankVsPosition: 2,
    });
    const base = 0.55;
    const adjusted = applyMatchupContextToProbability(base, ctx);
    assert.ok(adjusted < base, `expected < ${base}, got ${adjusted}`);
  });

  it('returns value with 6 decimal precision', () => {
    const ctx = computeMatchupContext({ sport: 'NBA' });
    const result = applyMatchupContextToProbability(0.5, ctx);
    const rounded = Math.round(result * 1e6) / 1e6;
    assert.equal(result, rounded);
  });
});
