export interface SegmentOutcomeRow {
  segment: string;
  outcome: 'win' | 'loss';
  trust?: number | null;
  edge?: number | null;
}

export interface SegmentPerformanceSummary {
  segment: string;
  picks: number;
  wins: number;
  losses: number;
  winRate: number;
  avgTrust: number | null;
  avgEdge: number | null;
}

export interface SegmentReadinessOptions {
  minimumSample?: number;
  limit?: number;
}

export interface SegmentReadinessResult {
  summaries: SegmentPerformanceSummary[];
  benchmarkCandidates: SegmentPerformanceSummary[];
}

export function summarizeSegmentPerformance(
  rows: SegmentOutcomeRow[],
): SegmentPerformanceSummary[] {
  const grouped = new Map<
    string,
    { wins: number; losses: number; trust: number[]; edge: number[] }
  >();

  for (const row of rows) {
    const segment = row.segment.trim();
    if (!segment) {
      continue;
    }

    const bucket = grouped.get(segment) ?? {
      wins: 0,
      losses: 0,
      trust: [],
      edge: [],
    };

    if (row.outcome === 'win') {
      bucket.wins += 1;
    } else {
      bucket.losses += 1;
    }

    if (typeof row.trust === 'number' && Number.isFinite(row.trust)) {
      bucket.trust.push(row.trust);
    }

    if (typeof row.edge === 'number' && Number.isFinite(row.edge)) {
      bucket.edge.push(row.edge);
    }

    grouped.set(segment, bucket);
  }

  return [...grouped.entries()]
    .map(([segment, bucket]) => {
      const picks = bucket.wins + bucket.losses;
      return {
        segment,
        picks,
        wins: bucket.wins,
        losses: bucket.losses,
        winRate: picks === 0 ? 0 : round2((bucket.wins / picks) * 100),
        avgTrust: average(bucket.trust),
        avgEdge: average(bucket.edge),
      };
    })
    .sort((left, right) => {
      if (right.picks !== left.picks) {
        return right.picks - left.picks;
      }

      if (right.winRate !== left.winRate) {
        return right.winRate - left.winRate;
      }

      return left.segment.localeCompare(right.segment);
    });
}

export function determineBenchmarkCandidates(
  summaries: SegmentPerformanceSummary[],
  options: SegmentReadinessOptions = {},
): SegmentPerformanceSummary[] {
  const minimumSample = options.minimumSample ?? 2;
  const limit = options.limit ?? 3;

  return summaries
    .filter((summary) => summary.picks >= minimumSample)
    .slice(0, limit);
}

export function buildSegmentReadinessResult(
  rows: SegmentOutcomeRow[],
  options: SegmentReadinessOptions = {},
): SegmentReadinessResult {
  const summaries = summarizeSegmentPerformance(rows);
  const benchmarkCandidates = determineBenchmarkCandidates(summaries, options);

  return {
    summaries,
    benchmarkCandidates,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
