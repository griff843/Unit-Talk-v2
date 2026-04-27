import { getBoardQueue } from '@/lib/data';
import type { BoardQueueData } from '@/lib/data';
import { BoardQueueTable } from '@/components/BoardQueueTable';

export default async function BoardQueuePage() {
  let queue: BoardQueueData;
  try {
    const result = await getBoardQueue();
    queue = result.ok ? result.data : { boardRunId: '', observedAt: new Date().toISOString(), totalRows: 0, pendingCount: 0, writtenCount: 0, rows: [] };
  } catch {
    queue = { boardRunId: '', observedAt: new Date().toISOString(), totalRows: 0, pendingCount: 0, writtenCount: 0, rows: [] };
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
        <h1 className="text-xl font-bold text-white">Board Queue</h1>
        <p className="mt-1 text-xs text-gray-500">
          Governed write surface — system-board candidates awaiting pick creation.
          {queue.boardRunId && (
            <>
              {' '}Run{' '}
              <span className="font-mono text-gray-400">{queue.boardRunId.slice(0, 8)}…</span>
              {' '}·{' '}
              <span className="text-gray-400">
                observed {new Date(queue.observedAt).toLocaleTimeString()}
              </span>
            </>
          )}
        </p>
      </div>

      {/* Governed write note */}
      <div className="rounded border border-blue-800/50 bg-blue-500/5 px-4 py-3 text-xs text-blue-300">
        <span className="font-semibold">Governed path only.</span>{' '}
        System-board picks are created exclusively via the "Write Picks" action below.
        The action is idempotent — candidates already linked to a pick are skipped.
        Source attribution on every created pick:{' '}
        <span className="font-mono text-blue-200">board-construction</span>.
      </div>

      <BoardQueueTable queue={queue} />
    </div>
  );
}
