'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { ReviewActions } from '@/components/ReviewActions';
import { BulkReviewBar } from '@/components/BulkReviewBar';
import Link from 'next/link';

interface ReviewPick {
  id: string;
  source: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  stake_units: number | null;
  promotion_score: number | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export function ReviewQueueClient({ picks, total }: { picks: ReviewPick[]; total: number }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function togglePick(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === picks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(picks.map((p) => p.id)));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  if (picks.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-500">No picks awaiting review.</p>
      </Card>
    );
  }

  const allSelected = picks.length > 0 && selectedIds.size === picks.length;

  return (
    <>
      <BulkReviewBar
        selectedIds={Array.from(selectedIds)}
        onClearSelection={clearSelection}
      />

      <div className="flex items-center gap-3 px-1">
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-950"
          />
          Select all ({picks.length})
        </label>
      </div>

      {picks.map((pick) => {
        const scores = pick.metadata?.['promotionScores'] as Record<string, number> | undefined;
        const isSelected = selectedIds.has(pick.id);
        return (
          <Card key={pick.id}>
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => togglePick(pick.id)}
                    className="mt-1 h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-950"
                    aria-label={`Select pick ${pick.id}`}
                  />
                  <div>
                    <Link href={`/picks/${pick.id}`} className="font-mono text-sm text-blue-400 hover:underline" aria-label={`Pick ${pick.id}`}>
                      {pick.id.slice(0, 12)}...
                    </Link>
                    <div className="mt-1 flex gap-4 text-xs text-gray-400">
                      <span>Source: <span className="text-gray-300">{pick.source}</span></span>
                      <span>Market: <span className="text-gray-300">{pick.market}</span></span>
                      <span>Selection: <span className="text-gray-300">{pick.selection}</span></span>
                    </div>
                    <div className="mt-1 flex gap-4 text-xs text-gray-400">
                      {pick.odds != null && <span>Odds: <span className="text-gray-300">{pick.odds}</span></span>}
                      {pick.line != null && <span>Line: <span className="text-gray-300">{pick.line}</span></span>}
                      {pick.stake_units != null && <span>Units: <span className="text-gray-300">{pick.stake_units}</span></span>}
                      <span>Created: <span className="text-gray-300">{new Date(pick.created_at).toLocaleString()}</span></span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-gray-200">
                    {pick.promotion_score != null ? pick.promotion_score.toFixed(1) : '\u2014'}
                  </div>
                  <div className="text-[10px] text-gray-500">score</div>
                </div>
              </div>

              {scores && (
                <div className="flex gap-3 text-xs text-gray-400">
                  {Object.entries(scores).map(([key, val]) => (
                    <span key={key}>{key}: <span className="text-gray-300">{typeof val === 'number' ? val.toFixed(0) : String(val)}</span></span>
                  ))}
                </div>
              )}

              {!isSelected && (
                <ReviewActions pickId={pick.id} decisions={['approve', 'deny', 'hold']} />
              )}
              {isSelected && (
                <p className="text-xs text-gray-500 italic">Selected for bulk action</p>
              )}
            </div>
          </Card>
        );
      })}
    </>
  );
}
