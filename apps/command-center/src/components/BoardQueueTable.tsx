'use client';

import { useState, useTransition } from 'react';
import { writeSystemPicks } from '@/app/actions/board';
import type { BoardQueueData, BoardQueueRow, WriteBoardPicksResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatOdds(odds: number | null): string {
  if (odds === null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatLine(line: number | null): string {
  if (line === null) return '—';
  return String(line);
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ row }: { row: BoardQueueRow }) {
  if (row.pickId !== null) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
        Written
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Pending
    </span>
  );
}

// ---------------------------------------------------------------------------
// Write result banner
// ---------------------------------------------------------------------------

function WriteResultBanner({ result }: { result: WriteBoardPicksResult }) {
  if (!result.ok) {
    return (
      <div className="rounded border border-red-700 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        <span className="font-semibold">Write failed:</span> {result.error}
      </div>
    );
  }

  return (
    <div className="rounded border border-green-700 bg-green-500/10 px-4 py-3 text-sm text-green-300">
      <span className="font-semibold">Write completed</span>
      <span className="ml-2 text-green-400">{result.written} written</span>
      {result.skipped > 0 && (
        <span className="ml-2 text-gray-400">{result.skipped} skipped</span>
      )}
      {result.errors > 0 && (
        <span className="ml-2 text-red-400">{result.errors} errors</span>
      )}
      <span className="ml-2 text-gray-500">{result.durationMs}ms</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface BoardQueueTableProps {
  queue: BoardQueueData;
}

export function BoardQueueTable({ queue }: BoardQueueTableProps) {
  const [isPending, startTransition] = useTransition();
  const [writeResult, setWriteResult] = useState<WriteBoardPicksResult | null>(null);

  function handleWritePicks() {
    startTransition(async () => {
      const result = await writeSystemPicks();
      setWriteResult(result);
    });
  }

  return (
    <div className="space-y-4">
      {/* Summary + action bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-4 text-sm">
          <span className="text-gray-400">
            <span className="text-white font-medium">{queue.totalRows}</span> total
          </span>
          <span className="text-amber-400">
            <span className="font-medium">{queue.pendingCount}</span> pending
          </span>
          <span className="text-green-400">
            <span className="font-medium">{queue.writtenCount}</span> written
          </span>
        </div>

        <button
          type="button"
          onClick={handleWritePicks}
          disabled={isPending || queue.pendingCount === 0}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
        >
          {isPending ? 'Writing…' : `Write ${queue.pendingCount} Pending Pick${queue.pendingCount !== 1 ? 's' : ''}`}
        </button>
      </div>

      {/* Result banner */}
      {writeResult && <WriteResultBanner result={writeResult} />}

      {/* Queue table */}
      {queue.rows.length === 0 ? (
        <div className="rounded border border-gray-800 bg-gray-900 px-4 py-8 text-center">
          <p className="text-sm text-gray-500">No board candidates in the latest run.</p>
          <p className="mt-1 text-xs text-gray-600">
            Run the board construction service to populate this queue.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900">
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Rank
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Market
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Line
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                  Over
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                  Under
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Sport
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                  Model Score
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Tier
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Status
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Pick
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {queue.rows.map((row) => (
                <tr key={row.candidateId} className="hover:bg-gray-900/50">
                  <td className="px-3 py-2 font-mono text-gray-300">
                    #{row.boardRank}
                  </td>
                  <td className="px-3 py-2 font-medium text-white">
                    {row.canonicalMarketKey || '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-400">
                    {formatLine(row.currentLine)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-300">
                    {formatOdds(row.currentOverOdds)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-300">
                    {formatOdds(row.currentUnderOdds)}
                  </td>
                  <td className="px-3 py-2 text-gray-400">
                    {row.sportKey.toUpperCase()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-400">
                    {(row.modelScore * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                      {row.boardTier}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge row={row} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">
                    {row.pickId ? (
                      <a
                        href={`/picks/${row.pickId}`}
                        className="text-blue-400 hover:text-blue-300 underline"
                      >
                        {row.pickId.slice(0, 8)}…
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

