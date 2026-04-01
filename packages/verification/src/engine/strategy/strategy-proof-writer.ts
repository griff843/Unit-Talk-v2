/**
 * VERIFICATION & SIMULATION CONTROL PLANE — StrategyProofWriter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R5
 *
 * Writes proof artifacts for strategy evaluation and comparison runs.
 *
 * Output structure:
 *   out/strategy-runs/<strategyId>/<YYYY-MM-DD>/
 *     ├── strategy-config.json
 *     ├── execution-simulations.json
 *     ├── bankroll-curve.json
 *     ├── drawdown-analysis.json
 *     ├── risk-events.json
 *     ├── correlation-events.json
 *     ├── strategy-report.json
 *     ├── strategy-report.md
 *     └── proof-bundle-checksum.txt
 *
 *   For comparison runs:
 *     out/strategy-runs/cmp-<A>-vs-<B>/<YYYY-MM-DD>/
 *       ├── comparison-report.json
 *       └── comparison-report.md
 *
 * Design law:
 *   - All output under out/ (gitignored — proof artifacts stay local)
 *   - No writes to production tables
 *   - Checksum computed over all artifact files for tamper detection
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { StrategyEvaluationResult, StrategyComparisonReport } from './types.js';

// ─────────────────────────────────────────────────────────────
// WRITER
// ─────────────────────────────────────────────────────────────

export class StrategyProofWriter {
  private readonly outRoot: string;

  /**
   * @param repoRoot Absolute path to the repository root.
   *                 Artifacts are written to <repoRoot>/out/strategy-runs/...
   */
  constructor(repoRoot: string) {
    this.outRoot = join(repoRoot, 'out', 'strategy-runs');
  }

  /**
   * Write all proof artifacts for a strategy evaluation run.
   * Returns the absolute path to the bundle directory.
   */
  writeEvaluation(result: StrategyEvaluationResult): string {
    const dateStr = new Date().toISOString().slice(0, 10); // WALL-CLOCK-ALLOWED: artifact path metadata
    const bundleDir = join(this.outRoot, result.strategyId, dateStr);

    if (!existsSync(bundleDir)) {
      mkdirSync(bundleDir, { recursive: true });
    }

    // 1. strategy-config.json
    this.writeJson(bundleDir, 'strategy-config.json', result.strategyConfig);

    // 2. execution-simulations.json
    this.writeJson(bundleDir, 'execution-simulations.json', {
      count: result.simulatedExecutions.length,
      withFriction: result.simulatedExecutions.length > 0,
      executions: result.simulatedExecutions,
    });

    // 3. bankroll-curve.json
    this.writeJson(bundleDir, 'bankroll-curve.json', {
      initialBankroll: result.initialBankroll,
      finalBankroll: result.finalBankroll,
      peakBankroll: result.peakBankroll,
      steps: result.bankrollCurve,
    });

    // 4. drawdown-analysis.json
    this.writeJson(bundleDir, 'drawdown-analysis.json', {
      maxDrawdown: result.maxDrawdown,
      maxDrawdownPct: (result.maxDrawdown * 100).toFixed(2) + '%',
      haltedAt: result.haltedAt ?? null,
      haltReason: result.haltReason ?? null,
      drawdownSeries: result.bankrollCurve.map(s => ({
        pickId: s.pickId,
        timestamp: s.timestamp,
        drawdownFromPeak: s.drawdownFromPeak,
        bankroll: s.bankrollAfter,
      })),
    });

    // 5. risk-events.json
    this.writeJson(bundleDir, 'risk-events.json', {
      count: result.riskEvents.length,
      events: result.riskEvents,
    });

    // 6. correlation-events.json
    this.writeJson(bundleDir, 'correlation-events.json', {
      count: result.correlationEvents.length,
      limitExceededCount: result.correlationEvents.filter(e => e.limitExceeded).length,
      events: result.correlationEvents,
    });

    // 7. strategy-report.json
    this.writeJson(bundleDir, 'strategy-report.json', this.buildReportData(result));

    // 8. strategy-report.md
    this.writeText(bundleDir, 'strategy-report.md', this.buildMarkdownReport(result));

    // 9. proof-bundle-checksum.txt
    const checksum = this.computeBundleChecksum(bundleDir, [
      'strategy-config.json',
      'execution-simulations.json',
      'bankroll-curve.json',
      'drawdown-analysis.json',
      'risk-events.json',
      'correlation-events.json',
      'strategy-report.json',
      'strategy-report.md',
    ]);
    this.writeText(
      bundleDir,
      'proof-bundle-checksum.txt',
      `Strategy: ${result.strategyId}\nSHA-256: ${checksum}\nComputed: ${new Date().toISOString()}\n` // WALL-CLOCK-ALLOWED: proof metadata
    );

    return bundleDir;
  }

  /**
   * Write proof artifacts for a strategy comparison run.
   * Returns the absolute path to the bundle directory.
   */
  writeComparison(report: StrategyComparisonReport): string {
    const dateStr = new Date().toISOString().slice(0, 10); // WALL-CLOCK-ALLOWED: artifact path metadata
    const dirName = report.comparisonId;
    const bundleDir = join(this.outRoot, dirName, dateStr);

    if (!existsSync(bundleDir)) {
      mkdirSync(bundleDir, { recursive: true });
    }

    // comparison-report.json
    this.writeJson(bundleDir, 'comparison-report.json', {
      comparisonId: report.comparisonId,
      generatedAt: report.generatedAt,
      strategyA: {
        id: report.strategyA.strategyId,
        description: report.strategyA.strategyConfig.description,
        roi: report.strategyA.roi,
        bankrollGrowth: report.strategyA.bankrollGrowth,
        maxDrawdown: report.strategyA.maxDrawdown,
        hitRate: report.strategyA.hitRate,
        betsPlaced: report.strategyA.betsPlaced,
        betsSkipped: report.strategyA.betsSkipped,
        betsRejected: report.strategyA.betsRejected,
        finalBankroll: report.strategyA.finalBankroll,
        avgCLV: report.strategyA.avgCLV,
        avgExecutionQuality: report.strategyA.avgExecutionQuality,
      },
      strategyB: {
        id: report.strategyB.strategyId,
        description: report.strategyB.strategyConfig.description,
        roi: report.strategyB.roi,
        bankrollGrowth: report.strategyB.bankrollGrowth,
        maxDrawdown: report.strategyB.maxDrawdown,
        hitRate: report.strategyB.hitRate,
        betsPlaced: report.strategyB.betsPlaced,
        betsSkipped: report.strategyB.betsSkipped,
        betsRejected: report.strategyB.betsRejected,
        finalBankroll: report.strategyB.finalBankroll,
        avgCLV: report.strategyB.avgCLV,
        avgExecutionQuality: report.strategyB.avgExecutionQuality,
      },
      delta: report.delta,
      winner: report.winner,
      summary: report.summary,
    });

    // comparison-report.md
    this.writeText(bundleDir, 'comparison-report.md', this.buildMarkdownComparison(report));

    return bundleDir;
  }

  // ─────────────────────────────────────────────────────────────
  // REPORT BUILDERS
  // ─────────────────────────────────────────────────────────────

  private buildReportData(result: StrategyEvaluationResult): Record<string, unknown> {
    return {
      strategyId: result.strategyId,
      runAt: result.runAt,
      summary: {
        totalPicksConsidered: result.totalPicksConsidered,
        betsPlaced: result.betsPlaced,
        betsSkipped: result.betsSkipped,
        betsRejected: result.betsRejected,
        hitRate: result.hitRate,
        hitRatePct: (result.hitRate * 100).toFixed(1) + '%',
        roi: result.roi,
        roiPct: (result.roi * 100).toFixed(2) + '%',
        bankrollGrowth: result.bankrollGrowth,
        bankrollGrowthPct: (result.bankrollGrowth * 100).toFixed(2) + '%',
        initialBankroll: result.initialBankroll,
        finalBankroll: result.finalBankroll,
        peakBankroll: result.peakBankroll,
        maxDrawdown: result.maxDrawdown,
        maxDrawdownPct: (result.maxDrawdown * 100).toFixed(2) + '%',
        avgCLV: result.avgCLV,
        avgExecutionQuality: result.avgExecutionQuality,
        riskEventCount: result.riskEvents.length,
        correlationEventCount: result.correlationEvents.length,
        haltedAt: result.haltedAt ?? null,
        haltReason: result.haltReason ?? null,
      },
    };
  }

  private buildMarkdownReport(result: StrategyEvaluationResult): string {
    const lines: string[] = [
      `# Strategy Report: ${result.strategyId}`,
      '',
      `**Run at:** ${result.runAt}`,
      `**Description:** ${result.strategyConfig.description ?? 'N/A'}`,
      '',
      '## Performance Summary',
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Bets Placed | ${result.betsPlaced} |`,
      `| Bets Skipped | ${result.betsSkipped} |`,
      `| Bets Rejected | ${result.betsRejected} |`,
      `| Hit Rate | ${(result.hitRate * 100).toFixed(1)}% |`,
      `| ROI | ${(result.roi * 100).toFixed(2)}% |`,
      `| Bankroll Growth | ${(result.bankrollGrowth * 100).toFixed(2)}% |`,
      `| Initial Bankroll | $${result.initialBankroll.toFixed(2)} |`,
      `| Final Bankroll | $${result.finalBankroll.toFixed(2)} |`,
      `| Peak Bankroll | $${result.peakBankroll.toFixed(2)} |`,
      `| Max Drawdown | ${(result.maxDrawdown * 100).toFixed(2)}% |`,
      `| Avg CLV | ${result.avgCLV.toFixed(2)} bps |`,
      `| Avg Execution Quality | ${(result.avgExecutionQuality * 100).toFixed(1)}% |`,
      '',
    ];

    if (result.haltedAt) {
      lines.push(`## ⚠️ Simulation Halted`);
      lines.push('');
      lines.push(`**Halted at:** ${result.haltedAt}`);
      lines.push(`**Reason:** ${result.haltReason}`);
      lines.push('');
    }

    if (result.riskEvents.length > 0) {
      lines.push('## Risk Events');
      lines.push('');
      lines.push('| Pick | Type | Detail |');
      lines.push('|------|------|--------|');
      for (const evt of result.riskEvents) {
        lines.push(`| ${evt.pickId} | ${evt.type} | ${evt.detail} |`);
      }
      lines.push('');
    }

    const limitedCorr = result.correlationEvents.filter(e => e.limitExceeded);
    if (limitedCorr.length > 0) {
      lines.push('## Correlation Limit Events');
      lines.push('');
      lines.push('| Label | Exposure | Limit | Exceeded |');
      lines.push('|-------|----------|-------|---------|');
      for (const evt of limitedCorr) {
        lines.push(
          `| ${evt.correlationLabel} | $${evt.totalExposure.toFixed(0)} | $${evt.limit.toFixed(0)} | ✅ |`
        );
      }
      lines.push('');
    }

    if (result.simulatedExecutions.length > 0) {
      lines.push('## Execution Simulation Summary');
      lines.push('');
      const rejected = result.simulatedExecutions.filter(e => e.rejected);
      lines.push(`- Executions simulated: ${result.simulatedExecutions.length}`);
      lines.push(`- Rejected: ${rejected.length}`);
      lines.push(`- Avg CLV: ${result.avgCLV.toFixed(2)} bps`);
      lines.push(`- Avg Execution Quality: ${(result.avgExecutionQuality * 100).toFixed(1)}%`);
      lines.push('');
    }

    lines.push('## Bankroll Curve');
    lines.push('');
    lines.push('| # | Pick | Odds | Stake | Result | PnL | Bankroll | Drawdown |');
    lines.push('|---|------|------|-------|--------|-----|----------|----------|');
    let idx = 1;
    for (const step of result.bankrollCurve) {
      if (step.stake > 0) {
        lines.push(
          `| ${idx++} | ${step.pickId} | ${step.executedOdds > 0 ? '+' : ''}${step.executedOdds} | $${step.stake.toFixed(2)} | ${step.settlementResult} | ${step.pnl >= 0 ? '+' : ''}$${step.pnl.toFixed(2)} | $${step.bankrollAfter.toFixed(2)} | ${(step.drawdownFromPeak * 100).toFixed(1)}% |`
        );
      }
    }
    lines.push('');

    lines.push('---');
    lines.push('');
    lines.push(`*Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R5*`);

    return lines.join('\n');
  }

  private buildMarkdownComparison(report: StrategyComparisonReport): string {
    const { strategyA: a, strategyB: b, delta, winner } = report;
    const lines: string[] = [
      `# Strategy Comparison: ${a.strategyId} vs ${b.strategyId}`,
      '',
      `**Comparison ID:** ${report.comparisonId}`,
      `**Generated:** ${report.generatedAt}`,
      '',
      '## Head-to-Head Metrics',
      '',
      `| Metric | ${a.strategyId} | ${b.strategyId} | Delta (A-B) | Winner |`,
      `|--------|${'-'.repeat(a.strategyId.length + 2)}|${'-'.repeat(b.strategyId.length + 2)}|------------|--------|`,
      `| ROI | ${(a.roi * 100).toFixed(2)}% | ${(b.roi * 100).toFixed(2)}% | ${(delta.roi * 100).toFixed(2)}% | **${winner.roi}** |`,
      `| Bankroll Growth | ${(a.bankrollGrowth * 100).toFixed(2)}% | ${(b.bankrollGrowth * 100).toFixed(2)}% | ${(delta.bankrollGrowth * 100).toFixed(2)}% | **${winner.bankrollGrowth}** |`,
      `| Final Bankroll | $${a.finalBankroll.toFixed(2)} | $${b.finalBankroll.toFixed(2)} | $${delta.finalBankroll.toFixed(2)} | — |`,
      `| Max Drawdown | ${(a.maxDrawdown * 100).toFixed(2)}% | ${(b.maxDrawdown * 100).toFixed(2)}% | ${(delta.maxDrawdown * 100).toFixed(2)}% | **${winner.maxDrawdown}** |`,
      `| Hit Rate | ${(a.hitRate * 100).toFixed(1)}% | ${(b.hitRate * 100).toFixed(1)}% | ${(delta.hitRate * 100).toFixed(1)}% | **${winner.hitRate}** |`,
      `| Bets Placed | ${a.betsPlaced} | ${b.betsPlaced} | ${delta.betsPlaced} | — |`,
      `| Bets Rejected | ${a.betsRejected} | ${b.betsRejected} | ${delta.betsRejected} | — |`,
      `| Avg CLV (bps) | ${a.avgCLV.toFixed(2)} | ${b.avgCLV.toFixed(2)} | ${delta.avgCLV.toFixed(2)} | — |`,
      `| Avg Exec Quality | ${(a.avgExecutionQuality * 100).toFixed(1)}% | ${(b.avgExecutionQuality * 100).toFixed(1)}% | ${(delta.avgExecutionQuality * 100).toFixed(1)}% | — |`,
      '',
      '## Summary',
      '',
      '```',
      report.summary,
      '```',
      '',
      '---',
      '',
      `*Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R5*`,
    ];

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────

  private writeJson(dir: string, filename: string, data: unknown): void {
    writeFileSync(join(dir, filename), JSON.stringify(data, null, 2) + '\n', 'utf8');
  }

  private writeText(dir: string, filename: string, content: string): void {
    writeFileSync(join(dir, filename), content, 'utf8');
  }

  private computeBundleChecksum(dir: string, files: string[]): string {
    const hash = createHash('sha256');
    for (const filename of files) {
      const filePath = join(dir, filename);
      if (existsSync(filePath)) {
        hash.update(readFileSync(filePath));
      }
    }
    return hash.digest('hex');
  }
}
