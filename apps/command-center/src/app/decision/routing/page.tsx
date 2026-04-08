export default function RoutingPreviewPage() {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
      <h1 className="text-xl font-bold text-white">Routing Preview</h1>
      <div className="rounded-md border border-yellow-800 bg-yellow-950/30 px-4 py-3">
        <p className="text-sm font-medium text-yellow-400">Shell — not yet connected</p>
        <p className="text-xs text-yellow-600 mt-1">
          Routing preview shows which distribution target a pick would reach given its current promotion state.
          Not yet connected to data source.
        </p>
      </div>
      <p className="text-xs text-gray-600">
        Data source: <code>picks.status</code>, <code>picks.promotion_target</code>, <code>distribution_outbox</code>
      </p>
    </div>
  );
}
