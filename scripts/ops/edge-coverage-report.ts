/**
 * Edge coverage report — UTV2-985
 *
 * Queries recent picks from the DB and computes the edge provenance breakdown:
 * - % using real market-backed edge (Pinnacle / consensus / SGO / single-book)
 * - % using confidence-delta (no market data)
 * - Provider coverage breakdown by tier
 *
 * Compares against the 12,043-pick audit baseline (0.2% real, 92.4% proxy).
 *
 * Usage:
 *   npx tsx scripts/ops/edge-coverage-report.ts [--days N] [--json] [--out FILE]
 */

import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const AUDIT_BASELINE = {
  pickCount: 12043,
  realEdgePct: 0.2,
  confidenceDeltaPct: 92.4,
  otherPct: 7.4,
};

interface EdgeCoverageBreakdown {
  total: number;
  byMethod: {
    marketDevigged: number;
    confidenceDelta: number;
    unknown: number;
  };
  byProviderTier: {
    pinnacle: number;
    consensus: number;
    sgo: number;
    singleBook: number;
    none: number;
    unknown: number;
  };
  percentages: {
    marketDevigged: number;
    confidenceDelta: number;
    pinnacle: number;
    consensus: number;
    sgo: number;
    singleBook: number;
    noMarketData: number;
  };
  baselineComparison: {
    auditPickCount: number;
    auditRealEdgePct: number;
    currentRealEdgePct: number;
    deltaRealEdgePct: number;
    auditConfidenceDeltaPct: number;
    currentConfidenceDeltaPct: number;
    deltaConfidenceDeltaPct: number;
  };
  generatedAt: string;
  daysQueried: number;
}

async function computeEdgeCoverage(days: number): Promise<EdgeCoverageBreakdown> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? process.env['SUPABASE_ANON_KEY'];

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const client = createClient(supabaseUrl, supabaseKey);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from('picks')
    .select('metadata')
    .gte('created_at', since)
    .not('metadata', 'is', null);

  if (error) throw new Error(`DB query failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`No picks found in the last ${days} days`);
  }

  const counts = {
    marketDevigged: 0,
    confidenceDelta: 0,
    unknown: 0,
    pinnacle: 0,
    consensus: 0,
    sgo: 0,
    singleBook: 0,
    none: 0,
    unknownTier: 0,
  };

  for (const row of data) {
    const meta = row.metadata as Record<string, unknown> | null;
    if (!meta) { counts.unknown++; continue; }

    // Prefer new edgeProvenance field (set after UTV2-985 fix)
    const provenance = meta['edgeProvenance'] as Record<string, unknown> | undefined;
    if (provenance && typeof provenance === 'object') {
      const method = provenance['method'];
      const tier = provenance['providerCoverageState'];

      if (method === 'market-devigged') {
        counts.marketDevigged++;
        if (tier === 'pinnacle') counts.pinnacle++;
        else if (tier === 'consensus') counts.consensus++;
        else if (tier === 'sgo') counts.sgo++;
        else if (tier === 'single-book') counts.singleBook++;
        else counts.unknownTier++;
      } else if (method === 'confidence-delta') {
        counts.confidenceDelta++;
        counts.none++;
      } else {
        counts.unknown++;
        counts.unknownTier++;
      }
      continue;
    }

    // Fall back to legacy realEdgeSource field (picks before UTV2-985)
    const realEdgeSource = (meta['realEdgeSource'] as string | undefined) ??
      ((meta['domainAnalysis'] as Record<string, unknown> | undefined)?.['realEdgeSource'] as string | undefined);

    if (!realEdgeSource || realEdgeSource === 'confidence-delta') {
      counts.confidenceDelta++;
      counts.none++;
    } else if (realEdgeSource === 'pinnacle') {
      counts.marketDevigged++; counts.pinnacle++;
    } else if (realEdgeSource === 'consensus') {
      counts.marketDevigged++; counts.consensus++;
    } else if (realEdgeSource === 'sgo') {
      counts.marketDevigged++; counts.sgo++;
    } else if (realEdgeSource === 'single-book') {
      counts.marketDevigged++; counts.singleBook++;
    } else {
      counts.unknown++;
      counts.unknownTier++;
    }
  }

  const total = data.length;
  const pct = (n: number) => total > 0 ? Math.round((n / total) * 1000) / 10 : 0;

  const currentRealEdgePct = pct(counts.marketDevigged);
  const currentConfidenceDeltaPct = pct(counts.confidenceDelta);

  return {
    total,
    byMethod: {
      marketDevigged: counts.marketDevigged,
      confidenceDelta: counts.confidenceDelta,
      unknown: counts.unknown,
    },
    byProviderTier: {
      pinnacle: counts.pinnacle,
      consensus: counts.consensus,
      sgo: counts.sgo,
      singleBook: counts.singleBook,
      none: counts.none,
      unknown: counts.unknownTier,
    },
    percentages: {
      marketDevigged: currentRealEdgePct,
      confidenceDelta: currentConfidenceDeltaPct,
      pinnacle: pct(counts.pinnacle),
      consensus: pct(counts.consensus),
      sgo: pct(counts.sgo),
      singleBook: pct(counts.singleBook),
      noMarketData: pct(counts.none),
    },
    baselineComparison: {
      auditPickCount: AUDIT_BASELINE.pickCount,
      auditRealEdgePct: AUDIT_BASELINE.realEdgePct,
      currentRealEdgePct,
      deltaRealEdgePct: Math.round((currentRealEdgePct - AUDIT_BASELINE.realEdgePct) * 10) / 10,
      auditConfidenceDeltaPct: AUDIT_BASELINE.confidenceDeltaPct,
      currentConfidenceDeltaPct,
      deltaConfidenceDeltaPct: Math.round((currentConfidenceDeltaPct - AUDIT_BASELINE.confidenceDeltaPct) * 10) / 10,
    },
    generatedAt: new Date().toISOString(),
    daysQueried: days,
  };
}

function printReport(report: EdgeCoverageBreakdown): void {
  const { percentages: p, byMethod: m, byProviderTier: t, baselineComparison: b } = report;

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  EDGE COVERAGE REPORT — UTV2-985');
  console.log(`  ${report.total.toLocaleString()} picks over last ${report.daysQueried} days`);
  console.log('═══════════════════════════════════════════════════\n');

  console.log('METHOD BREAKDOWN');
  console.log(`  Market-devigged (real edge):  ${p.marketDevigged}%  (${m.marketDevigged.toLocaleString()} picks)`);
  console.log(`  Confidence-delta (proxy):     ${p.confidenceDelta}%  (${m.confidenceDelta.toLocaleString()} picks)`);
  if (m.unknown > 0) {
    console.log(`  Unknown:                      ${report.total > 0 ? Math.round((m.unknown / report.total) * 1000) / 10 : 0}%  (${m.unknown.toLocaleString()} picks)`);
  }

  console.log('\nPROVIDER TIER BREAKDOWN (market-backed picks)');
  console.log(`  Pinnacle:      ${p.pinnacle}%  (${t.pinnacle.toLocaleString()})`);
  console.log(`  Consensus:     ${p.consensus}%  (${t.consensus.toLocaleString()})`);
  console.log(`  SGO:           ${p.sgo}%  (${t.sgo.toLocaleString()})`);
  console.log(`  Single-book:   ${p.singleBook}%  (${t.singleBook.toLocaleString()})`);
  console.log(`  No data (none):${p.noMarketData}%  (${t.none.toLocaleString()})`);

  console.log('\nBASELINE COMPARISON (vs 12,043-pick audit)');
  const deltaReal = b.deltaRealEdgePct >= 0 ? `+${b.deltaRealEdgePct}` : `${b.deltaRealEdgePct}`;
  const deltaCdelta = b.deltaConfidenceDeltaPct >= 0 ? `+${b.deltaConfidenceDeltaPct}` : `${b.deltaConfidenceDeltaPct}`;
  console.log(`  Real edge:       audit=${b.auditRealEdgePct}%  now=${b.currentRealEdgePct}%  delta=${deltaReal}%`);
  console.log(`  Confidence-delta:audit=${b.auditConfidenceDeltaPct}%  now=${b.currentConfidenceDeltaPct}%  delta=${deltaCdelta}%`);

  const improved = b.currentRealEdgePct > b.auditRealEdgePct;
  console.log(`\n  VERDICT: ${improved ? '✓ IMPROVED' : '✗ NOT YET IMPROVED'} vs audit baseline`);
  console.log('═══════════════════════════════════════════════════\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf('--days');
  const days = daysIndex >= 0 ? parseInt(args[daysIndex + 1] ?? '30', 10) : 30;
  const jsonMode = args.includes('--json');
  const outIndex = args.indexOf('--out');
  const outFile = outIndex >= 0 ? args[outIndex + 1] : null;

  const report = await computeEdgeCoverage(days);

  if (jsonMode || outFile) {
    const json = JSON.stringify(report, null, 2);
    if (outFile) {
      writeFileSync(outFile, json, 'utf-8');
      if (!jsonMode) console.log(`Report written to ${outFile}`);
    }
    if (jsonMode) {
      process.stdout.write(json + '\n');
      return;
    }
  }

  if (!jsonMode) {
    printReport(report);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((err: unknown) => {
    console.error('edge-coverage-report failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export { computeEdgeCoverage, type EdgeCoverageBreakdown };
