export default function RoiOverviewPage() {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Intelligence</p>
      <h1 className="text-xl font-bold text-white">ROI Overview</h1>
      <div className="rounded-md border border-yellow-800 bg-yellow-950/30 px-4 py-3">
        <p className="text-sm font-medium text-yellow-400">Shell — volume limited</p>
        <p className="text-xs text-yellow-600 mt-1">
          ROI by capper, tier, and market requires 50+ settled picks per cohort.
          Current volume is insufficient. Not yet connected to data source.
        </p>
      </div>
      <p className="text-xs text-gray-600">
        Data source: <code>settlement_records</code> + <code>picks</code> + <code>member_tiers</code> + <code>market_types</code>
      </p>
    </div>
  );
}
