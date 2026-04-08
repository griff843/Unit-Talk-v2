export default function ScoringCalibrationPage() {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Intelligence</p>
      <h1 className="text-xl font-bold text-white">Scoring Calibration</h1>
      <div className="rounded-md border border-yellow-800 bg-yellow-950/30 px-4 py-3">
        <p className="text-sm font-medium text-yellow-400">Shell — not operationally scheduled</p>
        <p className="text-xs text-yellow-600 mt-1">
          Calibration logic exists in <code>packages/domain</code> but is not yet scheduled for production runs.
          Not yet connected to data source.
        </p>
      </div>
      <p className="text-xs text-gray-600">
        Data source: <code>pick_promotion_history</code> + <code>settlement_records</code>
      </p>
    </div>
  );
}
