/**
 * StrategyComparator
 *
 * Compares two StrategyEvaluationResult instances and produces a
 * structured comparison report with delta metrics and winner determination.
 *
 * Design law:
 *   - Comparison is purely analytical — no production side effects
 *   - All deltas computed as A minus B (positive = A better)
 *   - Winner is 'tie' when delta is within noise threshold
 */

import type {
  StrategyEvaluationResult,
  StrategyComparisonReport,
  StrategyDelta,
  StrategyWinner,
} from './types.js';

// ─────────────────────────────────────────────────────────────
// COMPARATOR
// ─────────────────────────────────────────────────────────────

export class StrategyComparator {
  /**
   * Compare two strategy evaluation results.
   * All deltas are A minus B (positive = A better for positive metrics).
   *
   * @param strategyA  First strategy evaluation
   * @param strategyB  Second strategy evaluation
   * @param timestamp  Optional ISO timestamp (defaults to epoch for determinism)
   */
  compare(
    strategyA: StrategyEvaluationResult,
    strategyB: StrategyEvaluationResult,
    timestamp: string = new Date(0).toISOString(),
  ): StrategyComparisonReport {
    const comparisonId = `cmp-${strategyA.strategyId}-vs-${strategyB.strategyId}`;
    const generatedAt = timestamp;

    const delta: StrategyDelta = {
      roi: round4(strategyA.roi - strategyB.roi),
      bankrollGrowth: round4(strategyA.bankrollGrowth - strategyB.bankrollGrowth),
      maxDrawdown: round4(strategyA.maxDrawdown - strategyB.maxDrawdown),
      hitRate: round4(strategyA.hitRate - strategyB.hitRate),
      avgCLV: round2(strategyA.avgCLV - strategyB.avgCLV),
      avgExecutionQuality: round4(strategyA.avgExecutionQuality - strategyB.avgExecutionQuality),
      betsPlaced: strategyA.betsPlaced - strategyB.betsPlaced,
      betsRejected: strategyA.betsRejected - strategyB.betsRejected,
      finalBankroll: round2(strategyA.finalBankroll - strategyB.finalBankroll),
    };

    const winner: StrategyWinner = {
      // Higher ROI is better
      roi: determineWinner(delta.roi, 0.001),
      // Lower max drawdown is better (for drawdown, A winning means A had LESS drawdown → negative delta)
      maxDrawdown: determineWinner(-delta.maxDrawdown, 0.001),
      // Higher bankroll growth is better
      bankrollGrowth: determineWinner(delta.bankrollGrowth, 0.001),
      // Higher hit rate is better
      hitRate: determineWinner(delta.hitRate, 0.01),
    };

    const summary = this.buildSummary(strategyA, strategyB, delta, winner);

    return {
      comparisonId,
      generatedAt,
      strategyA,
      strategyB,
      delta,
      winner,
      summary,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // SUMMARY BUILDER
  // ─────────────────────────────────────────────────────────────

  private buildSummary(
    a: StrategyEvaluationResult,
    b: StrategyEvaluationResult,
    delta: StrategyDelta,
    winner: StrategyWinner,
  ): string {
    const lines: string[] = [
      `Strategy Comparison: ${a.strategyId} vs ${b.strategyId}`,
      '',
      `ROI:         ${a.strategyId}=${(a.roi * 100).toFixed(2)}%  vs  ${b.strategyId}=${(b.roi * 100).toFixed(2)}%  →  delta=${(delta.roi * 100).toFixed(2)}%  winner=${winner.roi}`,
      `Bankroll:    ${a.strategyId}=$${a.finalBankroll.toFixed(2)}  vs  ${b.strategyId}=$${b.finalBankroll.toFixed(2)}  →  delta=$${delta.finalBankroll.toFixed(2)}  winner=${winner.bankrollGrowth}`,
      `Max DD:      ${a.strategyId}=${(a.maxDrawdown * 100).toFixed(2)}%  vs  ${b.strategyId}=${(b.maxDrawdown * 100).toFixed(2)}%  →  winner=${winner.maxDrawdown} (less DD)`,
      `Hit Rate:    ${a.strategyId}=${(a.hitRate * 100).toFixed(1)}%  vs  ${b.strategyId}=${(b.hitRate * 100).toFixed(1)}%`,
      `Bets Placed: ${a.strategyId}=${a.betsPlaced}  vs  ${b.strategyId}=${b.betsPlaced}`,
      `Rejected:    ${a.strategyId}=${a.betsRejected}  vs  ${b.strategyId}=${b.betsRejected}`,
      `Avg CLV:     ${a.strategyId}=${a.avgCLV.toFixed(2)}bps  vs  ${b.strategyId}=${b.avgCLV.toFixed(2)}bps`,
      '',
      (() => {
        const winners = Object.values(winner);
        const aWins = winners.filter((w) => w === 'A').length;
        const bWins = winners.filter((w) => w === 'B').length;
        if (aWins > bWins)
          return `Overall recommendation: ${a.strategyId} wins ${aWins}/${winners.length} metrics`;
        if (bWins > aWins)
          return `Overall recommendation: ${b.strategyId} wins ${bWins}/${winners.length} metrics`;
        return `Overall: Tied (${aWins}/${winners.length} each)`;
      })(),
    ];

    return lines.join('\n');
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Returns 'A', 'B', or 'tie' based on delta and noise threshold. */
function determineWinner(delta: number, threshold: number): string {
  if (delta > threshold) return 'A';
  if (delta < -threshold) return 'B';
  return 'tie';
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
