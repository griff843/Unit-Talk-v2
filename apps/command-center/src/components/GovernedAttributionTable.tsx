'use client';

import { useMemo } from 'react';
import type { GovernedPickPerformanceRow } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatOdds(odds: number | null): string {
  if (odds === null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatScore(score: number | null): string {
  if (score === null) return '—';
  return `${(score * 100).toFixed(1)}%`;
}

function formatShortId(id: string | null): string {
  if (!id) return '—';
  return `${id.slice(0, 8)}…`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Settlement badge
// ---------------------------------------------------------------------------

function SettlementBadge({ row }: { row: GovernedPickPerformanceRow }) {
  if (row.settlement_result === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-gray-700/40 px-2 py-0.5 text-xs font-medium text-gray-400">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
        Unsettled
      </span>
    );
  }
  const result = row.settlement_result.toLowerCase();
  const styles: Record<string, string> = {
    win: 'bg-green-500/20 text-green-400',
    loss: 'bg-red-500/20 text-red-400',
    push: 'bg-yellow-500/20 text-yellow-400',
    void: 'bg-gray-500/20 text-gray-400',
  };
  const className = styles[result] ?? 'bg-blue-500/20 text-blue-400';
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${className}`}>
      {row.settlement_result.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tier badge
// ---------------------------------------------------------------------------

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-gray-600">—</span>;
  return (
    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
      {tier}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------

interface SummaryStats {
  totalRows: number;
  uniquePicks: number;
  uniqueBoardRuns: number;
  settledCount: number;
  winCount: number;
  lossCount: number;
  pushCount: number;
  voidCount: number;
  unsettledCount: number;
  sportBreakdown: Array<{ sport: string; count: number }>;
  marketFamilyBreakdown: Array<{ marketTypeId: string; count: number }>;
}

function computeSummary(rows: GovernedPickPerformanceRow[]): SummaryStats {
  const uniquePicks = new Set(rows.map((r) => r.pick_id));
  const uniqueBoardRuns = new Set(rows.map((r) => r.board_run_id).filter(Boolean));

  let winCount = 0;
  let lossCount = 0;
  let pushCount = 0;
  let voidCount = 0;
  let unsettledCount = 0;

  const sportCounts = new Map<string, number>();
  const marketCounts = new Map<string, number>();

  for (const row of rows) {
    const result = row.settlement_result?.toLowerCase() ?? null;
    if (result === null) unsettledCount++;
    else if (result === 'win') winCount++;
    else if (result === 'loss') lossCount++;
    else if (result === 'push') pushCount++;
    else if (result === 'void') voidCount++;

    const sport = row.sport_key ?? 'unknown';
    sportCounts.set(sport, (sportCounts.get(sport) ?? 0) + 1);

    const market = row.market_type_id ?? 'unknown';
    marketCounts.set(market, (marketCounts.get(market) ?? 0) + 1);
  }

  const sortByCountDesc = (a: { count: number }, b: { count: number }) => b.count - a.count;

  return {
    totalRows: rows.length,
    uniquePicks: uniquePicks.size,
    uniqueBoardRuns: uniqueBoardRuns.size,
    settledCount: winCount + lossCount + pushCount + voidCount,
    winCount,
    lossCount,
    pushCount,
    voidCount,
    unsettledCount,
    sportBreakdown: Array.from(sportCounts.entries())
      .map(([sport, count]) => ({ sport, count }))
      .sort(sortByCountDesc),
    marketFamilyBreakdown: Array.from(marketCounts.entries())
      .map(([marketTypeId, count]) => ({ marketTypeId, count }))
      .sort(sortByCountDesc),
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface GovernedAttributionTableProps {
  rows: GovernedPickPerformanceRow[];
}

export function GovernedAttributionTable({ rows }: GovernedAttributionTableProps) {
  const summary = useMemo(() => computeSummary(rows), [rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded border border-gray-800 bg-gray-900 px-4 py-8 text-center">
        <p className="text-sm text-gray-500">No governed pick attribution data yet.</p>
        <p className="mt-1 text-xs text-gray-600">
          Run the board writer to create{' '}
          <span className="font-mono text-gray-500">source=board-construction</span> picks.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border border-gray-800 bg-gray-900 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">Attribution Rows</p>
          <p className="mt-1 text-2xl font-bold text-white">{summary.totalRows}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {summary.uniquePicks} unique picks · {summary.uniqueBoardRuns} board runs
          </p>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">Settled</p>
          <p className="mt-1 text-2xl font-bold text-white">{summary.settledCount}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {summary.unsettledCount} unsettled
          </p>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">W / L / P</p>
          <p className="mt-1 text-2xl font-bold">
            <span className="text-green-400">{summary.winCount}</span>
            <span className="text-gray-600"> · </span>
            <span className="text-red-400">{summary.lossCount}</span>
            <span className="text-gray-600"> · </span>
            <span className="text-yellow-400">{summary.pushCount}</span>
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {summary.settledCount > 0
              ? `${((summary.winCount / Math.max(summary.winCount + summary.lossCount, 1)) * 100).toFixed(1)}% win rate`
              : 'no settled rows'}
          </p>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">Top Sport</p>
          <p className="mt-1 text-2xl font-bold text-white">
            {summary.sportBreakdown[0]?.sport.toUpperCase() ?? '—'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {summary.sportBreakdown[0]?.count ?? 0} rows
          </p>
        </div>
      </div>

      {/* Market family breakdown */}
      {summary.marketFamilyBreakdown.length > 0 && (
        <div className="rounded border border-gray-800 bg-gray-900 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">Market Family Distribution</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.marketFamilyBreakdown.slice(0, 12).map((m) => (
              <span
                key={m.marketTypeId}
                className="inline-flex items-center gap-1.5 rounded bg-gray-800 px-2 py-1 text-xs"
              >
                <span className="font-mono text-gray-300">{m.marketTypeId}</span>
                <span className="text-gray-500">{m.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Attribution table */}
      <div className="overflow-x-auto rounded border border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Pick
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Sport
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Market
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Selection
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                Odds
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                Model
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Tier
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                Rank
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Board Run
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Candidate
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Result
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {rows.map((row, idx) => (
              <tr
                key={`${row.pick_id}-${row.board_run_id ?? 'none'}-${idx}`}
                className="hover:bg-gray-900/50"
              >
                <td className="px-3 py-2 font-mono text-xs">
                  <a
                    href={`/picks/${row.pick_id}`}
                    className="text-blue-400 hover:text-blue-300 underline"
                  >
                    {formatShortId(row.pick_id)}
                  </a>
                </td>
                <td className="px-3 py-2 text-gray-400">
                  {row.sport_key?.toUpperCase() ?? '—'}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-300">
                  {row.market_type_id ?? row.market ?? '—'}
                </td>
                <td className="px-3 py-2 text-white">{row.selection ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-300">
                  {formatOdds(row.odds)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-400">
                  {formatScore(row.candidate_model_score)}
                </td>
                <td className="px-3 py-2">
                  <TierBadge tier={row.model_tier ?? row.board_tier} />
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-400">
                  {row.board_rank !== null ? `#${row.board_rank}` : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500">
                  {formatShortId(row.board_run_id)}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500">
                  {formatShortId(row.candidate_id)}
                </td>
                <td className="px-3 py-2">
                  <SettlementBadge row={row} />
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {formatDate(row.pick_created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
