import { getBoardPerformance } from '@/lib/data';
import { GovernedAttributionTable } from '@/components/GovernedAttributionTable';
import type { GovernedPickPerformanceRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function GovernedAttributionPage() {
  let rows: GovernedPickPerformanceRow[] = [];
  let fetchError: string | null = null;

  try {
    const result = await getBoardPerformance();
    if (result.ok) rows = result.data;
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Intelligence</p>
        <h1 className="text-xl font-bold text-white">Governed Pick Attribution</h1>
        <p className="mt-1 text-xs text-gray-500">
          Phase 6 feedback-loop substrate — full attribution chain for every{' '}
          <span className="font-mono text-gray-400">source=board-construction</span> pick.
        </p>
      </div>

      {/* Explanation note */}
      <div className="rounded border border-purple-800/50 bg-purple-500/5 px-4 py-3 text-xs text-purple-300">
        <span className="font-semibold">Attribution chain:</span>{' '}
        <span className="font-mono">picks → pick_candidates → syndicate_board → market_universe → settlement_records</span>.
        {' '}Sourced from{' '}
        <span className="font-mono text-purple-200">v_governed_pick_performance</span>{' '}
        (UTV2-479, migration{' '}
        <span className="font-mono text-purple-200">202604100001</span>).
        {' '}Unsettled picks show NULL settlement fields — they populate automatically once graded and feed{' '}
        <span className="font-mono text-purple-200">market_family_trust</span>{' '}
        tuning runs (UTV2-480).
      </div>

      {fetchError && (
        <div className="rounded border border-red-800 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="font-semibold">Fetch failed:</span> {fetchError}
        </div>
      )}

      <GovernedAttributionTable rows={rows} />
    </div>
  );
}
