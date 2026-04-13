export default function ScoringCalibrationPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Intelligence</p>
        <h1 className="text-xl font-bold text-white">Scoring Calibration</h1>
      </div>

      <div className="rounded-md border border-gray-700 bg-gray-900/50 px-4 py-6 text-center">
        <p className="text-sm text-gray-400">Calibration data not yet available.</p>
        <p className="text-xs text-gray-600 mt-2">
          Scoring calibration compares promotion score predictions against actual settlement
          outcomes. The domain logic exists but is not yet scheduled for production runs.
        </p>
      </div>

      <div className="rounded border border-gray-800 bg-gray-900/30 p-4 text-xs text-gray-600 space-y-2">
        <p className="font-medium text-gray-500">Requirements for live data:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Scheduled calibration job computing score-vs-outcome accuracy</li>
          <li>Operator-web API endpoint to serve calibration results</li>
          <li>Sufficient settled volume: 50+ picks per score band</li>
          <li>Domain logic: <code className="text-gray-400">packages/domain/src/calibration/</code> (exists)</li>
          <li>Data sources: <code className="text-gray-400">pick_promotion_history</code> + <code className="text-gray-400">settlement_records</code></li>
        </ul>
      </div>
    </div>
  );
}
