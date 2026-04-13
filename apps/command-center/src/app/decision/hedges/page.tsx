export default function HedgeOverlaysPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
        <h1 className="text-xl font-bold text-white">Hedge Overlays</h1>
      </div>

      <div className="rounded-md border border-gray-700 bg-gray-900/50 px-4 py-6 text-center">
        <p className="text-sm text-gray-400">No hedge opportunities detected.</p>
        <p className="text-xs text-gray-600 mt-2">
          Hedge overlays appear automatically when the system detects hedge, middle, or arbitrage
          conditions across active picks. This is a valid empty state when no conditions exist.
        </p>
      </div>

      <div className="rounded border border-gray-800 bg-gray-900/30 p-4 text-xs text-gray-600 space-y-2">
        <p className="font-medium text-gray-500">Requirements for live data:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Hedge detection scheduled job writing to <code className="text-gray-400">hedge_opportunities</code></li>
          <li>Operator-web API endpoint to serve hedge rows</li>
          <li>Domain logic: <code className="text-gray-400">packages/domain/src/hedge-detection.ts</code> (exists)</li>
        </ul>
      </div>
    </div>
  );
}
