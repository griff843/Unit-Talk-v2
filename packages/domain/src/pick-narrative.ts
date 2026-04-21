/**
 * Template-based pick narrative generation (UTV2-635).
 *
 * Produces concise, human-readable explanations from promotion decision inputs.
 * All output is derived mechanically from score values and edge source — no
 * AI generation, no hallucination risk. Every sentence maps 1:1 to a signal.
 */

import type {
  EdgeSourceQuality,
  PromotionScoreBreakdown,
  PromotionTarget,
} from '@unit-talk/contracts';

export interface PickNarrativeInput {
  qualified: boolean;
  target: PromotionTarget | undefined;
  score: number;
  breakdown: Omit<PromotionScoreBreakdown, 'total'>;
  edgeSourceQuality: EdgeSourceQuality | undefined;
  edgeSource: string | undefined;
  market: string | undefined;
  sport: string | undefined;
  suppressionReasons: string[];
  minimumScore: number;
}

const TARGET_LABELS: Record<PromotionTarget, string> = {
  'exclusive-insights': 'Exclusive Insights',
  'trader-insights': 'Trader Insights',
  'best-bets': 'Best Bets',
};

function edgeSourcePhrase(quality: EdgeSourceQuality | undefined, source: string | undefined): string {
  if (quality === 'market-backed') {
    if (source === 'consensus-edge' || source === 'real-edge') return 'market-backed consensus edge';
    if (source === 'sgo-edge') return 'SGO sharp-book edge';
    if (source === 'single-book-edge') return 'single-book edge';
    return 'market-backed edge';
  }
  if (quality === 'explicit') return 'explicit model edge';
  return 'confidence-derived edge';
}

function scoreLabel(score: number): string {
  if (score >= 85) return 'strong';
  if (score >= 75) return 'solid';
  if (score >= 65) return 'adequate';
  return 'below-average';
}

function trustPhrase(trust: number): string {
  if (trust >= 80) return `trust well above minimum`;
  if (trust >= 65) return `trust above minimum`;
  return `trust near minimum`;
}

function weakestComponent(breakdown: Omit<PromotionScoreBreakdown, 'total'>): string {
  const entries = Object.entries(breakdown) as [string, number][];
  const [name] = entries.sort((a, b) => a[1] - b[1])[0]!;
  return name;
}

function marketPhrase(market: string | undefined, sport: string | undefined): string {
  if (market && sport) return `${sport} ${market}`;
  if (market) return market;
  if (sport) return sport;
  return 'pick';
}

/**
 * Generate a 1-3 sentence narrative explanation for a promotion decision.
 * Output is deterministic and fully traceable to the input signals.
 */
export function generatePickNarrative(input: PickNarrativeInput): string {
  const {
    qualified,
    target,
    score,
    breakdown,
    edgeSourceQuality,
    edgeSource,
    market,
    sport,
    suppressionReasons,
    minimumScore,
  } = input;

  if (qualified && target) {
    const edgePhrase = edgeSourcePhrase(edgeSourceQuality, edgeSource);
    const marketStr = marketPhrase(market, sport);
    const edgeQual = scoreLabel(breakdown.edge);
    const targetLabel = TARGET_LABELS[target];

    const sentence1 = `${edgeQual.charAt(0).toUpperCase() + edgeQual.slice(1)} ${edgePhrase} on ${marketStr}.`;
    let sentence2 = `${trustPhrase(breakdown.trust)}.`;
    const sentence3 = `Score ${Math.round(score)}/100 — promoted to ${targetLabel}.`;

    if (breakdown.readiness < 65) {
      sentence2 += ` Readiness below average.`;
    }

    return `${sentence1} ${sentence2} ${sentence3}`;
  }

  // Suppressed / not eligible
  if (suppressionReasons.length === 0) {
    return `Score ${Math.round(score)}/100 did not meet the ${Math.round(minimumScore)}/100 threshold.`;
  }

  // Board cap
  const boardCap = suppressionReasons.find(r => r.includes('board cap') || r.includes('board capacity'));
  if (boardCap) {
    const sportStr = sport ? `${sport} ` : '';
    return `Not promoted — ${sportStr}board capacity limit reached. Requeue when the board clears.`;
  }

  // Gate failure
  const gate = suppressionReasons.find(r =>
    r.includes('stale') || r.includes('window') || r.includes('blocked') || r.includes('market')
  );
  if (gate) {
    return `Blocked by eligibility gate: ${gate}.`;
  }

  // Score below threshold
  const scoreBelow = suppressionReasons.find(r => r.includes('below threshold'));
  if (scoreBelow) {
    const weak = weakestComponent(breakdown);
    return `Score ${Math.round(score)}/100 below threshold ${Math.round(minimumScore)}/100. Primary drag: ${weak} (${Math.round(breakdown[weak as keyof typeof breakdown] ?? 0)}/100).`;
  }

  // Fallback: list first two reasons
  const reasons = suppressionReasons.slice(0, 2).join('; ');
  return `Not promoted — ${reasons}.`;
}
