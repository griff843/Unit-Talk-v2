import { Card, EmptyState, MetricsCard } from '@/components/ui';
import { getIntelligenceData } from '@/lib/data';

function formatPercent(value: number | null) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
}

function tone(value: number | null) {
  if (value == null || !Number.isFinite(value)) return 'text-gray-300';
  return value >= 0 ? 'text-emerald-400' : 'text-red-400';
}

export default async function ScoringCalibrationPage() {
  const data = await getIntelligenceData();

  if (!data) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Intelligence</p>
          <h1 className="text-xl font-bold text-white">Model Feedback Scaffold</h1>
        </div>

        <EmptyState
          message="Unable to load feedback scaffold data."
          detail="The scaffold depends on settled-pick intelligence data from the database."
        />
      </div>
    );
  }

  const sampleSize = data.scoreQuality.scoreVsOutcome.sampleSize;
  const recentFeedback = data.feedbackLoop.slice(0, 10);
  const sportWindows = Object.entries(data.recentForm.bySport);
  const sourceWindows = Object.entries(data.recentForm.bySource);
  const staleMarkers = data.insights.warnings.filter((warning) =>
    /sample|reliable|predictive|criteria/i.test(warning.message),
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Intelligence</p>
        <h1 className="text-xl font-bold text-white">Model Feedback Scaffold</h1>
      </div>

      <div className="rounded-md border border-blue-800/50 bg-blue-950/20 px-4 py-4 text-sm text-blue-100">
        This is the scaffold for `UTV2-798`: it uses settled-pick outcomes, score bands,
        CLV-backed settlement payloads, and source/sport windows that already exist today.
        Champion-model linkage, calibration-grade confidence curves, and missing-champion coverage
        are still intentionally pending.
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricsCard label="Settled feedback rows" value={String(data.feedbackLoop.length)} />
        <MetricsCard label="Score/outcome sample" value={String(sampleSize)} />
        <MetricsCard
          label="Score correlation"
          value={data.scoreQuality.scoreVsOutcome.correlation}
        />
        <MetricsCard
          label="Approved vs denied ROI"
          value={`${data.decisionQuality.approvedVsDeniedRoiDelta >= 0 ? '+' : ''}${data.decisionQuality.approvedVsDeniedRoiDelta.toFixed(1)}%`}
          trend={data.decisionQuality.approvedVsDeniedRoiDelta > 0 ? 'up' : data.decisionQuality.approvedVsDeniedRoiDelta < 0 ? 'down' : 'flat'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Calibration Spine">
          <div className="space-y-2 text-sm text-gray-300">
            <div>
              Avg score on wins:{' '}
              <span className="font-medium text-emerald-400">
                {data.scoreQuality.scoreVsOutcome.avgScoreWins?.toFixed(1) ?? '—'}
              </span>
            </div>
            <div>
              Avg score on losses:{' '}
              <span className="font-medium text-red-400">
                {data.scoreQuality.scoreVsOutcome.avgScoreLosses?.toFixed(1) ?? '—'}
              </span>
            </div>
            <div>
              Approved win rate:{' '}
              <span className="font-medium">{formatPercent(data.decisionQuality.approvedWinRate)}</span>
            </div>
            <div>
              Denied would-have-won:{' '}
              <span className="font-medium">{formatPercent(data.decisionQuality.deniedWouldHaveWonRate)}</span>
            </div>
            <div className="text-xs text-gray-500">
              Current scaffold evaluates score bands and operator decisions against settled outcomes.
              It does not yet prove champion-model attribution or calibration curves.
            </div>
          </div>
        </Card>

        <Card title="Stale / Degraded Markers">
          {staleMarkers.length === 0 ? (
            <p className="text-sm text-gray-400">No scaffold warnings are currently active.</p>
          ) : (
            <div className="space-y-2">
              {staleMarkers.map((warning) => (
                <div key={`${warning.segment}-${warning.message}`} className="rounded border border-yellow-800/50 bg-yellow-900/20 px-3 py-2 text-xs text-yellow-100">
                  <span className="font-medium">{warning.segment}:</span> {warning.message}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Market / Sport Review">
          {sportWindows.length === 0 ? (
            <p className="text-sm text-gray-400">No sport windows are available yet.</p>
          ) : (
            <div className="space-y-2">
              {sportWindows.slice(0, 8).map(([sport, form]) => (
                <div key={sport} className="flex items-center justify-between border-b border-gray-800 py-2 text-sm last:border-0">
                  <span className="text-gray-300">{sport}</span>
                  <span className={tone(form.last20.roiPct)}>
                    {form.last20.wins}-{form.last20.losses}-{form.last20.pushes} / {formatPercent(form.last20.roiPct)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Source / Tier Proxy">
          {sourceWindows.length === 0 ? (
            <p className="text-sm text-gray-400">No source windows are available yet.</p>
          ) : (
            <div className="space-y-2">
              {sourceWindows.slice(0, 8).map(([source, form]) => (
                <div key={source} className="flex items-center justify-between border-b border-gray-800 py-2 text-sm last:border-0">
                  <span className="text-gray-300">{source}</span>
                  <span className={tone(form.last20.roiPct)}>
                    {form.last20.streak} / {formatPercent(form.last20.roiPct)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Representative Feedback Rows">
        {recentFeedback.length === 0 ? (
          <p className="text-sm text-gray-400">No settled feedback rows are available yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Pick</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Sport</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Result</th>
                  <th className="py-2 pr-3">Score Call</th>
                  <th className="py-2">Decision Call</th>
                </tr>
              </thead>
              <tbody>
                {recentFeedback.map((entry) => (
                  <tr key={entry.pickId} className="border-b border-gray-800 text-xs last:border-0">
                    <td className="py-2 pr-3 font-mono text-gray-400">{entry.pickId.slice(0, 8)}</td>
                    <td className="py-2 pr-3 text-gray-300">{entry.source}</td>
                    <td className="py-2 pr-3 text-gray-300">{entry.sport}</td>
                    <td className="py-2 pr-3 text-gray-300">{entry.promotionScore?.toFixed(1) ?? '—'}</td>
                    <td className={`py-2 pr-3 font-medium ${entry.result === 'win' ? 'text-emerald-400' : entry.result === 'loss' ? 'text-red-400' : 'text-gray-300'}`}>
                      {entry.result}
                    </td>
                    <td className="py-2 pr-3 text-gray-300">{entry.scoreSignal ?? '—'}</td>
                    <td className="py-2 text-gray-300">
                      {entry.reviewWasRight == null ? '—' : entry.reviewWasRight ? 'correct' : 'wrong'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="rounded border border-gray-800 bg-gray-900/30 p-4 text-xs text-gray-600 space-y-2">
        <p className="font-medium text-gray-500">Next build steps for full `UTV2-798`:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Join scored candidates and champion-model metadata back onto settled picks.</li>
          <li>Expose tier taxonomy explicitly instead of inferring source buckets as a temporary proxy.</li>
          <li>Add missing-champion and stale-data coverage counters to this page.</li>
          <li>Promote this scaffold into a dashboard-ready model feedback API once live calibration is ratified.</li>
        </ul>
      </div>
    </div>
  );
}
