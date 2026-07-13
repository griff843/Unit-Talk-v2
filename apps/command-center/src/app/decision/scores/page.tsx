import { getBoardState } from '@/lib/data';
import type { BoardStateData } from '@/lib/types';
import { ScoreBreakdownBar } from '@/components/ScoreBreakdownBar';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata = { title: 'Scores — Unit Talk Command Center' };

export default async function ScoreBreakdownPage() {
  const boardResult = await getBoardState();
  const board = (boardResult.ok ? boardResult.data : null) as BoardStateData;

  // Sort by thresholdDelta descending — highest above threshold first
  const sorted = [...board.scoreBreakdowns].sort(
    (a, b) => b.thresholdDelta - a.thresholdDelta,
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="mt-1 text-xs text-gray-500">
          24h window — target: <span className="text-gray-300">{board.target}</span> —
          {sorted.length} record{sorted.length !== 1 ? 's' : ''}
        </p>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          message="No score records"
          detail="No promotion history records in the last 24h for this target."
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((breakdown, index) => (
            <ScoreBreakdownBar key={`${breakdown.pickId}-${index}`} breakdown={breakdown} />
          ))}
        </div>
      )}
    </div>
  );
}
