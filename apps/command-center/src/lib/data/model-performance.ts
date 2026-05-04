/**
 * Command Center data fetch for model performance analytics — UTV2-798.
 *
 * Calls GET /api/model-performance and returns the typed report.
 * Data is calibration evidence only — not used for scoring decisions.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Types (mirrored from apps/api/src/model-performance-service.ts)
// We re-declare here to avoid cross-app imports.
// ---------------------------------------------------------------------------

export interface ModelPerformanceTierBucket {
  tier: string | null;
  totalPicks: number;
  settledPicks: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  avgClv: number | null;
  avgModelScore: number | null;
}

export interface ModelPerformanceSportMarketBreakdown {
  sportKey: string;
  marketKeyFamily: string;
  totalPicks: number;
  settledPicks: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgClv: number | null;
}

export interface ModelPerformanceChampionCoverage {
  totalPicks: number;
  withModelConfidence: number;
  withoutModelConfidence: number;
  coverageRate: number | null;
  missingGapCount: number;
}

export interface ModelPerformanceStaleBucket {
  stalePicks: number;
  settledStalePicks: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgClv: number | null;
}

export interface ModelPerformanceReport {
  calibrationNotice: 'CALIBRATION_EVIDENCE_ONLY';
  generatedAt: string;
  totalPostedPicks: number;
  totalSettledPicks: number;
  filters: {
    sport: string | null;
    tier: string | null;
    dateFrom: string | null;
    dateTo: string | null;
  };
  tierPerformance: ModelPerformanceTierBucket[];
  sportMarketBreakdown: ModelPerformanceSportMarketBreakdown[];
  championModelCoverage: ModelPerformanceChampionCoverage;
  staleBucket: ModelPerformanceStaleBucket;
}

export interface ModelPerformanceFilters {
  sport?: string;
  tier?: string;
  from?: string;
  to?: string;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

function buildApiUrl(base: string, filters?: ModelPerformanceFilters): string {
  const url = new URL('/api/model-performance', base);
  if (filters?.sport) url.searchParams.set('sport', filters.sport);
  if (filters?.tier) url.searchParams.set('tier', filters.tier);
  if (filters?.from) url.searchParams.set('from', filters.from);
  if (filters?.to) url.searchParams.set('to', filters.to);
  return url.toString();
}

/**
 * Fetches the model performance calibration report from the API.
 *
 * @param apiBaseUrl - Base URL of the API server (e.g. http://localhost:4000)
 * @param filters    - Optional query filters
 * @returns Typed report or null on error
 */
export async function getModelPerformance(
  apiBaseUrl: string,
  filters?: ModelPerformanceFilters,
): Promise<ModelPerformanceReport | null> {
  try {
    const url = buildApiUrl(apiBaseUrl, filters);
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      // Node 18+ fetch — no credentials needed (GET endpoint is unauthenticated)
    });

    if (!res.ok) {
      console.error('[model-performance] API responded with status', res.status);
      return null;
    }

    const body = (await res.json()) as any;
    if (!body?.ok || !body?.report) {
      console.error('[model-performance] Unexpected response shape:', body);
      return null;
    }

    return body.report as ModelPerformanceReport;
  } catch (err) {
    console.error('[model-performance] fetch error:', err);
    return null;
  }
}
