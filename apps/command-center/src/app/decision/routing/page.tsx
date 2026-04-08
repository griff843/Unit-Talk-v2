export default function RoutingPreviewPage() {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
      <h1 className="text-xl font-bold text-white">Routing Preview</h1>
      <p className="text-sm text-gray-400">Coming soon — not yet connected to data source.</p>
      <p className="text-xs text-gray-600">
        Data source: <code>picks.status</code>, <code>picks.promotion_target</code>, <code>distribution_outbox</code>
      </p>
    </div>
  );
}
