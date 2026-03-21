/**
 * Baseline ROI Report — capstone outcome tracking module
 *
 * Composes performance report, alpha evaluation, and loss attribution
 * into a single diagnostic report that answers:
 *   - Is the system profitable?
 *   - How well calibrated is the model?
 *   - Why are losses occurring?
 *   - What should be improved?
 */

import { computeAlphaEvaluation } from '../evaluation/alpha-evaluation.js';

import { summarizeLossAttributions } from './loss-attribution.js';
import { bridgeBatchToEvaluation } from './outcome-bridge.js';
import { generatePerformanceReport } from './performance-report.js';

import type { LossAttributionOutput, LossAttributionSummary } from './loss-attribution.js';
import type { ScoredOutcome, PerformanceReport } from './types.js';
import type { AlphaEvaluationReport } from '../evaluation/alpha-evaluation.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface BaselineROIReport {
  report_version: string;
  generated_at: string;
  sample_size: number;

  performance: PerformanceReport;
  alpha_evaluation: AlphaEvaluationReport;
  loss_attribution: LossAttributionSummary;

  diagnostics: {
    is_profitable: boolean;
    flat_bet_roi_pct: number;
    directional_accuracy_pct: number;
    brier_score: number;
    top_loss_category: string;
    recommendation: string;
  };
}

export type BaselineROIResult =
  | { ok: true; data: BaselineROIReport }
  | { ok: false; reason: string };

// ── Core Function ───────────────────────────────────────────────────────────

export function generateBaselineROIReport(
  scoredOutcomes: ScoredOutcome[],
  lossAttributions: LossAttributionOutput[],
  options?: { sport?: string; timestamp?: string },
): BaselineROIResult {
  if (scoredOutcomes.length === 0) {
    return { ok: false, reason: 'No scored outcomes provided' };
  }

  const performance = generatePerformanceReport(scoredOutcomes);

  const bridgeResult = bridgeBatchToEvaluation(scoredOutcomes, options);
  const alpha_evaluation = computeAlphaEvaluation(bridgeResult.records);

  const loss_attribution = summarizeLossAttributions(lossAttributions);

  const isProfitable = performance.overall.flat_bet_roi_pct > 0;
  const topCategory = loss_attribution.total_losses > 0 ? loss_attribution.top_category : 'N/A';

  const recommendation = deriveRecommendation(
    isProfitable,
    performance.overall.flat_bet_roi_pct,
    topCategory,
    loss_attribution,
    alpha_evaluation.brier_score,
  );

  return {
    ok: true,
    data: {
      report_version: 'baseline-roi-v1.0',
      generated_at: options?.timestamp ?? new Date().toISOString(),
      sample_size: scoredOutcomes.length,
      performance,
      alpha_evaluation,
      loss_attribution,
      diagnostics: {
        is_profitable: isProfitable,
        flat_bet_roi_pct: performance.overall.flat_bet_roi_pct,
        directional_accuracy_pct: performance.overall.directional_accuracy_pct,
        brier_score: alpha_evaluation.brier_score,
        top_loss_category: topCategory,
        recommendation,
      },
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function deriveRecommendation(
  isProfitable: boolean,
  roiPct: number,
  topCategory: string,
  lossAttribution: LossAttributionSummary,
  brierScore: number,
): string {
  if (lossAttribution.total_losses === 0) {
    if (isProfitable)
      return 'Profitable with no tracked losses. Instrument loss attribution for deeper analysis.';
    return 'Not profitable. Instrument loss attribution for diagnosis.';
  }

  const topPct = lossAttribution.by_category[0]?.pct ?? 0;
  const prefix = isProfitable
    ? `Profitable (${roiPct > 0 ? '+' : ''}${roiPct.toFixed(1)}% ROI).`
    : `Unprofitable (${roiPct.toFixed(1)}% ROI).`;

  const brierNote = brierScore > 0.25 ? ' Model calibration is weak (Brier > 0.25).' : '';

  const categoryNote = ` Primary loss driver: ${topCategory} (${topPct.toFixed(0)}% of losses).`;

  const actionMap: Record<string, string> = {
    PROJECTION_MISS: ' Focus on improving stat projection accuracy.',
    PRICE_MISS: ' Focus on line timing and closing line capture.',
    VARIANCE: ' Losses are within expected variance — maintain course.',
    UNKNOWN: ' Improve feature snapshot instrumentation.',
  };

  const action = actionMap[topCategory] ?? '';

  return `${prefix}${brierNote}${categoryNote}${action}`;
}
