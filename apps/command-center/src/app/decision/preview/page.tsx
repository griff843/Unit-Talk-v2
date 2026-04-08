export default function PromotionPreviewPage() {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
      <h1 className="text-xl font-bold text-white">Promotion Preview</h1>
      <p className="text-sm text-gray-400">Coming soon — not yet connected to data source.</p>
      <p className="text-xs text-gray-600">
        Data source: <code>pick_promotion_history</code> + live promotion engine re-evaluation (read-only)
      </p>
    </div>
  );
}
