export default function TrendFiltersPage() {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
      <h1 className="text-xl font-bold text-white">Trend Filters</h1>
      <div className="rounded-md border border-gray-700 bg-gray-900 px-4 py-3">
        <p className="text-sm font-medium text-gray-400">Coming soon — requires stat history ingest</p>
        <p className="text-xs text-gray-600 mt-1">
          Trend and split filters require a historical box score ingest pipeline that is not in the current milestone.
          This surface will be activated once <code>player_game_stats</code> data is available.
        </p>
      </div>
    </div>
  );
}
