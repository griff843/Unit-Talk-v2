import Link from 'next/link';

export default function TrendFiltersPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Trend Filters</h1>
      </div>

      <div className="rounded-md border border-gray-700 bg-gray-900 px-4 py-4">
        <p className="text-sm font-medium text-gray-300">Deferred -- requires data pipeline</p>
        <p className="text-xs text-gray-500 mt-2">
          Trend and split filters require a historical box score ingest pipeline that populates the{' '}
          <code className="text-gray-400">player_game_stats</code> table. This table does not
          exist in the current schema and the ingest pipeline is not in the active milestone.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          This surface will be activated once the following are in place:
        </p>
        <ul className="mt-2 space-y-1 text-xs text-gray-500 list-disc list-inside">
          <li><code className="text-gray-400">player_game_stats</code> table created via migration</li>
          <li>Box score ingest pipeline (source TBD) populating historical stats</li>
          <li>Operator-web endpoint exposing trend/split query results</li>
        </ul>
      </div>

      <Link
        href="/research"
        className="self-start rounded px-3 py-1.5 text-xs font-medium text-blue-400 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
      >
        Back to Research
      </Link>
    </div>
  );
}
