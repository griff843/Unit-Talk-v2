export interface UniquenessInput {
  activeSameSportMarketCount?: number | undefined;
  lineDeviationPoints?: number | undefined;
}

export function computeUniquenessScore(input: UniquenessInput): number {
  const { activeSameSportMarketCount, lineDeviationPoints } = input;
  if (activeSameSportMarketCount === undefined) return 50;
  const saturation = 100 - Math.min(activeSameSportMarketCount * 10, 80);
  const bonus = lineDeviationPoints !== undefined ? Math.min(lineDeviationPoints * 20, 40) : 0;
  return Math.min(100, Math.max(0, saturation + bonus));
}
