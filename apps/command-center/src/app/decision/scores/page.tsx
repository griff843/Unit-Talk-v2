import { fetchBoardState } from '../../../lib/api.js';
import { ScoreBreakdownBar } from '../../../components/ScoreBreakdownBar.js';
import { EmptyState } from '../../../components/ui/EmptyState.js';

export default async function ScoreBreakdownPage() {
  const board = await fetchBoardState();

  // Sort by thresholdDelta descending — highest above threshold first
  const sorted = [...board.scoreBreakdowns].sort(
    (a, b) => b.thresholdDelta - a.thresholdDelta,
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
        <h1 className="text-xl font-bold text-white">Score Breakdown</h1>
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
          {sorted.map((breakdown) => (
            <ScoreBreakdownBar key={breakdown.pickId} breakdown={breakdown} />
          ))}
        </div>
      )}
    </div>
  );
}
