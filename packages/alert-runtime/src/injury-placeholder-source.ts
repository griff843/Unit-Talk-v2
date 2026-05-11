import type { NormalizedInjuryReport } from './injury-types.js';

export async function fetchInjuryReports(
  sport: string,
): Promise<NormalizedInjuryReport[]> {
  void sport;

  return []; // TODO(UTV2-897): wire real sources per PM-approved priority list
}
