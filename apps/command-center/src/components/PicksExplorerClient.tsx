'use client';

interface PicksExplorerClientProps {
  picks: Array<Record<string, unknown>>;
  observedAt: string;
}

export function PicksExplorerClient({ picks, observedAt }: PicksExplorerClientProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100">Picks Explorer</h1>
          <p className="text-sm text-gray-500">{picks.length} picks loaded</p>
        </div>
        <span className="text-xs text-gray-500">{new Date(observedAt).toLocaleString()}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-[11px] uppercase tracking-[0.16em] text-gray-500">
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Market</th>
              <th className="px-4 py-2">Selection</th>
              <th className="px-4 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((pick, i) => (
              <tr key={String(pick['id'] ?? i)} className="border-b border-gray-900 text-gray-300">
                <td className="px-4 py-2 font-mono text-xs">{String(pick['id'] ?? '–').slice(0, 8)}</td>
                <td className="px-4 py-2">{String(pick['status'] ?? '–')}</td>
                <td className="px-4 py-2">{String(pick['market'] ?? '–')}</td>
                <td className="px-4 py-2">{String(pick['selection'] ?? '–')}</td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {pick['created_at'] ? new Date(String(pick['created_at'])).toLocaleString() : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
