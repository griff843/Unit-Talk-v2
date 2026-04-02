import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function roundRate(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function readWindowDays(request: IncomingMessage) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const rawWindow = url.searchParams.get('window')?.trim() ?? '7d';
  const parsed = rawWindow.endsWith('d')
    ? Number.parseInt(rawWindow.slice(0, -1), 10)
    : Number.parseInt(rawWindow, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { label: '7d', days: 7 };
  }

  return { label: `${parsed}d`, days: parsed };
}

function mapEdgeSourceBucket(edgeSource: string | null) {
  switch ((edgeSource ?? '').toLowerCase()) {
    case 'real-edge':
    case 'pinnacle':
      return 'realEdge' as const;
    case 'consensus':
    case 'consensus-edge':
      return 'consensusEdge' as const;
    case 'sgo':
    case 'sgo-edge':
      return 'sgoEdge' as const;
    case 'confidence-delta':
      return 'confidenceDelta' as const;
    case 'explicit':
      return 'explicit' as const;
    default:
      return 'unknown' as const;
  }
}

function createEmptyCoverage(window: string) {
  return {
    window,
    totalPicks: 0,
    picksWithOdds: 0,
    domainAnalysis: { count: 0, rate: 0 },
    deviggingResult: { count: 0, rate: 0 },
    kellySizing: { count: 0, rate: 0 },
    realEdge: { count: 0, rate: 0 },
    edgeSourceDistribution: {
      realEdge: 0,
      consensusEdge: 0,
      sgoEdge: 0,
      confidenceDelta: 0,
      explicit: 0,
      unknown: 0,
    },
    clvCoverage: {
      settledPicks: 0,
      withClv: 0,
      rate: 0,
    },
  };
}

/**
 * GET /api/operator/intelligence-coverage
 *
 * Burn-in aggregate truth surface for enrichment coverage and edge-source mix.
 */
export async function handleIntelligenceCoverageRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const { label: window, days } = readWindowDays(request);
  const provider = deps.provider as unknown as { _supabaseClient?: unknown };

  if (!provider._supabaseClient) {
    writeJson(response, 200, { ok: true, data: createEmptyCoverage(window) });
    return;
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;

  const [picksResult, settlementsResult] = await Promise.all([
    client
      .from('picks')
      .select('id, created_at, odds, metadata')
      .gte('created_at', cutoff),
    client
      .from('settlement_records')
      .select('id, created_at, status, payload')
      .eq('status', 'settled')
      .gte('created_at', cutoff),
  ]);

  if (picksResult.error || settlementsResult.error) {
    writeJson(response, 500, {
      ok: false,
      error: {
        code: 'DB_ERROR',
        message: String(picksResult.error ?? settlementsResult.error),
      },
    });
    return;
  }

  const picks = (picksResult.data ?? []) as Array<Record<string, unknown>>;
  const settlements = (settlementsResult.data ?? []) as Array<Record<string, unknown>>;
  const coverage = createEmptyCoverage(window);
  coverage.totalPicks = picks.length;

  let domainAnalysisCount = 0;
  let devigCount = 0;
  let kellyCount = 0;
  let realEdgeCount = 0;

  for (const pick of picks) {
    const metadata = asRecord(pick['metadata']);
    const domainAnalysis = asRecord(metadata['domainAnalysis']);
    const odds = asNumber(pick['odds']);

    if (odds !== null) {
      coverage.picksWithOdds += 1;
    }
    if (Object.keys(domainAnalysis).length > 0) {
      domainAnalysisCount += 1;
      const bucket = mapEdgeSourceBucket(asString(domainAnalysis['realEdgeSource']));
      coverage.edgeSourceDistribution[bucket] += 1;
    } else {
      coverage.edgeSourceDistribution.unknown += 1;
    }
    if (metadata['deviggingResult'] != null) {
      devigCount += 1;
    }
    if (metadata['kellySizing'] != null) {
      kellyCount += 1;
    }
    if (domainAnalysis['realEdge'] != null) {
      realEdgeCount += 1;
    }
  }

  const oddsDenominator = coverage.picksWithOdds > 0 ? coverage.picksWithOdds : coverage.totalPicks;
  coverage.domainAnalysis = {
    count: domainAnalysisCount,
    rate: roundRate(domainAnalysisCount, oddsDenominator),
  };
  coverage.deviggingResult = {
    count: devigCount,
    rate: roundRate(devigCount, oddsDenominator),
  };
  coverage.kellySizing = {
    count: kellyCount,
    rate: roundRate(kellyCount, oddsDenominator),
  };
  coverage.realEdge = {
    count: realEdgeCount,
    rate: roundRate(realEdgeCount, oddsDenominator),
  };

  const settledPicks = settlements.length;
  const withClv = settlements.filter((row) => {
    const payload = asRecord(row['payload']);
    return payload['clvRaw'] != null || payload['clvPercent'] != null;
  }).length;

  coverage.clvCoverage = {
    settledPicks,
    withClv,
    rate: roundRate(withClv, settledPicks),
  };

  writeJson(response, 200, { ok: true, data: coverage });
}
