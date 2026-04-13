export default function PromotionPreviewPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
        <h1 className="text-xl font-bold text-white">Promotion Preview</h1>
      </div>

      <div className="rounded-md border border-gray-700 bg-gray-900/50 px-4 py-6 text-center">
        <p className="text-sm text-gray-400">Promotion preview not yet connected.</p>
        <p className="text-xs text-gray-600 mt-2">
          This surface will re-evaluate the promotion engine in read-only mode for a given pick,
          showing what score and target it would receive under the current policy. Useful for
          debugging promotion decisions and testing policy changes.
        </p>
      </div>

      <div className="rounded border border-gray-800 bg-gray-900/30 p-4 text-xs text-gray-600 space-y-2">
        <p className="font-medium text-gray-500">Requirements for live data:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>API endpoint for read-only promotion re-evaluation given a pick ID</li>
          <li>Operator-web proxy route to serve the result</li>
          <li>Data sources: <code className="text-gray-400">pick_promotion_history</code> + live promotion engine</li>
        </ul>
      </div>
    </div>
  );
}
