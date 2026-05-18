export interface UniquenessInput {
  activeSameSportMarketCount?: number | undefined;
  activeSelectionOverlapCount?: number | undefined;
  lineDeviationPoints?: number | undefined;
}

export interface UniquenessResult {
  score: number;
  fallbackReason?: string;
  dimensions: {
    sameSportMarketCount: number;
    selectionOverlapCount: number;
  } | null;
}

export function computeUniquenessWithMeta(input: UniquenessInput): UniquenessResult {
  const { activeSameSportMarketCount, activeSelectionOverlapCount, lineDeviationPoints } = input;

  if (activeSameSportMarketCount === undefined) {
    return {
      score: 50,
      fallbackReason: 'no-open-picks-data',
      dimensions: null,
    };
  }

  const saturation = 100 - Math.min(activeSameSportMarketCount * 10, 80);
  const selectionPenalty = activeSelectionOverlapCount !== undefined
    ? Math.min(activeSelectionOverlapCount * 15, 30)
    : 0;
  const bonus = lineDeviationPoints !== undefined ? Math.min(lineDeviationPoints * 20, 40) : 0;
  const score = Math.min(100, Math.max(0, saturation - selectionPenalty + bonus));

  return {
    score,
    dimensions: {
      sameSportMarketCount: activeSameSportMarketCount,
      selectionOverlapCount: activeSelectionOverlapCount ?? 0,
    },
  };
}

export function computeUniquenessScore(input: UniquenessInput): number {
  return computeUniquenessWithMeta(input).score;
}
