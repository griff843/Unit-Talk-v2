export default function PromotionPreviewPage() {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
      <h1 className="text-xl font-bold text-white">Promotion Preview</h1>
      <div className="rounded-md border border-yellow-800 bg-yellow-950/30 px-4 py-3">
        <p className="text-sm font-medium text-yellow-400">Shell — not yet connected</p>
        <p className="text-xs text-yellow-600 mt-1">
          Promotion preview re-evaluates the live promotion engine in read-only mode for a given pick.
          Not yet connected to data source.
        </p>
      </div>
      <p className="text-xs text-gray-600">
        Data source: <code>pick_promotion_history</code> + live promotion engine re-evaluation (read-only)
      </p>
    </div>
  );
}
