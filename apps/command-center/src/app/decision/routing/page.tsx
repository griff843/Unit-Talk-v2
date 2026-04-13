export default function RoutingPreviewPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
        <h1 className="text-xl font-bold text-white">Routing Preview</h1>
      </div>

      <div className="rounded-md border border-gray-700 bg-gray-900/50 px-4 py-6 text-center">
        <p className="text-sm text-gray-400">Routing preview not yet connected.</p>
        <p className="text-xs text-gray-600 mt-2">
          This surface will show which distribution target (best-bets, trader-insights, canary)
          a pick would reach given its current promotion state and the active routing rules.
        </p>
      </div>

      <div className="rounded border border-gray-800 bg-gray-900/30 p-4 text-xs text-gray-600 space-y-2">
        <p className="font-medium text-gray-500">Requirements for live data:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>API endpoint for pick-level routing resolution</li>
          <li>Operator-web proxy route to serve the result</li>
          <li>Data sources: <code className="text-gray-400">picks.status</code>, <code className="text-gray-400">picks.promotion_target</code>, <code className="text-gray-400">distribution_outbox</code></li>
        </ul>
      </div>
    </div>
  );
}
