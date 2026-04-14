import { fetchBoardState } from '@/lib/api';
import { BoardCapacityGauge } from '@/components/BoardCapacityGauge';
import { ConflictCard } from '@/components/ConflictCard';
import { EmptyState } from '@/components/ui/EmptyState';

export default async function BoardSaturationPage() {
  const board = await fetchBoardState();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
        <h1 className="text-xl font-bold text-white">Board Saturation</h1>
        <p className="mt-1 text-xs text-gray-500">
          24h window — target: <span className="text-gray-300">{board.target}</span> —
          computed <span className="text-gray-300">{new Date(board.computedAt).toLocaleTimeString()}</span>
        </p>
      </div>

      {/* Slate capacity (full width) */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300">Slate Capacity</h2>
        <BoardCapacityGauge
          label="Total slate"
          current={board.slate.current}
          cap={board.slate.cap}
          utilization={board.slate.utilization}
          status={board.slate.status}
        />
      </section>

      {/* Per-sport */}
      {board.bySport.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-300">By Sport</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {board.bySport.map((s) => (
              <BoardCapacityGauge
                key={s.sportKey}
                label={s.sportKey.toUpperCase()}
                current={s.current}
                cap={s.cap}
                utilization={s.utilization}
                status={s.status}
              />
            ))}
          </div>
        </section>
      )}

      {/* Per-game */}
      {board.byGame.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-300">By Game</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {board.byGame.map((g) => (
              <BoardCapacityGauge
                key={g.gameId}
                label={g.gameId}
                current={g.current}
                cap={g.cap}
                utilization={g.utilization}
                status={g.status}
              />
            ))}
          </div>
        </section>
      )}

      {/* Conflict cards */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300">
          Conflict Cards
          {board.conflictCards.length > 0 && (
            <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-400">
              {board.conflictCards.length}
            </span>
          )}
        </h2>
        {board.conflictCards.length === 0 ? (
          <EmptyState
            message="No conflict cards"
            detail="No picks scored above threshold but were blocked in the last 24h."
          />
        ) : (
          <div className="space-y-2">
            {board.conflictCards.map((card) => (
              <ConflictCard key={card.pickId} card={card} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
