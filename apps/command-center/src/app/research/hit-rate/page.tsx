export default function HitRatePage() {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
      <h1 className="text-xl font-bold text-white">Hit Rate</h1>
      <div className="rounded-md border border-yellow-800 bg-yellow-950/30 px-4 py-3">
        <p className="text-sm font-medium text-yellow-400">Shell — volume limited</p>
        <p className="text-xs text-yellow-600 mt-1">
          Hit rate displays when N &ge; 100 settled picks. Current volume is insufficient.
          N count will be shown once data source is connected.
        </p>
      </div>
      <p className="text-xs text-gray-600">Data source: <code>settlement_records</code> + <code>picks</code></p>
    </div>
  );
}
