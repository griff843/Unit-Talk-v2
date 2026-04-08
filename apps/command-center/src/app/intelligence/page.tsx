import { Card, EmptyState, MetricsCard } from '@/components/ui';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

interface MiniStats {
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  streak: string;
}

interface FormWindow {
  last5: MiniStats;
  last10: MiniStats;
  last20: MiniStats;
}

interface ScoreBand {
  range: string;
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
}

interface FeedbackEntry {
  pickId: string;
  source: string;
  sport: string;
  promotionScore: number | null;
  reviewDecision: string | null;
  result: string;
  scoreSignal: 'correct' | 'incorrect' | 'marginal' | null;
  reviewWasRight: boolean | null;
}

interface IntelligenceData {
  recentForm: {
    overall: FormWindow;
    capper: FormWindow;
    system: FormWindow;
    approved: FormWindow;
    denied: FormWindow;
    bySport: Record<string, FormWindow>;
    bySource: Record<string, FormWindow>;
  };
  scoreQuality: {
    bands: ScoreBand[];
    scoreVsOutcome: {
      avgScoreWins: number | null;
      avgScoreLosses: number | null;
      correlation: 'positive' | 'weak' | 'negative' | 'insufficient_data';
      sampleSize: number;
      confidence: 'high' | 'medium' | 'low' | 'none';
    };
  };
  decisionQuality: {
    approvedWinRate: number | null;
    deniedWouldHaveWonRate: number | null;
    approvedVsDeniedRoiDelta: number;
    holdsResolvedCount: number;
    holdsTotal: number;
  };
  feedbackLoop: FeedbackEntry[];
  insights: {
    bestScoreBand: { range: string; roiPct: number } | null;
    warnings: Array<{ segment: string; message: string }>;
  };
  observedAt: string;
}

async function fetchIntelligence(): Promise<IntelligenceData | null> {
  try {
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/intelligence`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data: IntelligenceData };
    return json.ok ? json.data : null;
  } catch {
    return null;
  }
}

function FormRow({ label, stats }: { label: string; stats: MiniStats }) {
  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
      <td className="py-2 pr-3 text-xs font-medium text-gray-200">{label}</td>
      <td className="py-2 pr-3 text-xs text-gray-300">
        <span className="text-emerald-400">{stats.wins}</span>-
        <span className="text-red-400">{stats.losses}</span>-
        <span className="text-gray-400">{stats.pushes}</span>
      </td>
      <td className="py-2 pr-3 text-xs text-gray-300">{stats.hitRatePct.toFixed(1)}%</td>
      <td className={`py-2 pr-3 text-xs font-medium ${stats.roiPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {stats.roiPct >= 0 ? '+' : ''}{stats.roiPct.toFixed(1)}%
      </td>
      <td className="py-2 text-xs text-gray-400">{stats.streak}</td>
    </tr>
  );
}

function RecentFormTable({ title, form }: { title: string; form: FormWindow }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">{title}</p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
            <th className="py-1.5 pr-3">Window</th>
            <th className="py-1.5 pr-3">Record</th>
            <th className="py-1.5 pr-3">Hit Rate</th>
            <th className="py-1.5 pr-3">ROI</th>
            <th className="py-1.5">Streak</th>
          </tr>
        </thead>
        <tbody>
          <FormRow label="Last 5" stats={form.last5} />
          <FormRow label="Last 10" stats={form.last10} />
          <FormRow label="Last 20" stats={form.last20} />
        </tbody>
      </table>
    </div>
  );
}

function CorrelationBadge({ value }: { value: string }) {
  const colors: Record<string, string> = {
    positive: 'bg-emerald-900/50 text-emerald-400 border-emerald-700',
    weak: 'bg-yellow-900/50 text-yellow-400 border-yellow-700',
    negative: 'bg-red-900/50 text-red-400 border-red-700',
    insufficient_data: 'bg-gray-800 text-gray-400 border-gray-700',
  };
  const labels: Record<string, string> = {
    positive: 'Positive',
    weak: 'Weak',
    negative: 'Negative',
    insufficient_data: 'Insufficient Data',
  };
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${colors[value] ?? colors['insufficient_data']}`}>
      {labels[value] ?? value}
    </span>
  );
}

function ScoreSignalBadge({ value }: { value: 'correct' | 'incorrect' | 'marginal' | null }) {
  if (value === null) return <span className="text-xs text-gray-500">--</span>;
  if (value === 'correct') return <span className="text-xs font-medium text-emerald-400">Correct</span>;
  if (value === 'marginal') return <span className="text-xs font-medium text-yellow-400">Marginal</span>;
  return <span className="text-xs font-medium text-red-400">Wrong</span>;
}

function RightWrongBadge({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-xs text-gray-500">--</span>;
  return value
    ? <span className="text-xs font-medium text-emerald-400">Correct</span>
    : <span className="text-xs font-medium text-red-400">Wrong</span>;
}

export default async function IntelligencePage() {
  const data = await fetchIntelligence();

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-lg font-bold text-gray-100">Intelligence</h1>
        <EmptyState
          message="Unable to load intelligence data."
          detail="Check that operator-web is reachable and the /api/operator/intelligence endpoint is responding."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-100">Intelligence</h1>
        <span className="text-xs text-gray-500">
          Observed {new Date(data.observedAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Warnings */}
      {data.insights.warnings.length > 0 && (
        <Card title="Warnings">
          <div className="flex flex-col gap-2">
            {data.insights.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 rounded border border-yellow-800/50 bg-yellow-900/20 p-3 text-sm">
                <span className="text-yellow-400 font-medium shrink-0">{w.segment}</span>
                <span className="text-yellow-200">{w.message}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent Form */}
      <Card title="Recent Form">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <RecentFormTable title="Overall" form={data.recentForm.overall} />
          <RecentFormTable title="Capper" form={data.recentForm.capper} />
          <RecentFormTable title="System" form={data.recentForm.system} />
          <RecentFormTable title="Approved" form={data.recentForm.approved} />
          <RecentFormTable title="Denied" form={data.recentForm.denied} />
        </div>

        {Object.keys(data.recentForm.bySport).length > 0 && (
          <>
            <h3 className="mt-6 mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">By Sport</h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {Object.entries(data.recentForm.bySport).map(([sport, form]) => (
                <RecentFormTable key={sport} title={sport} form={form} />
              ))}
            </div>
          </>
        )}

        {Object.keys(data.recentForm.bySource).length > 0 && (
          <>
            <h3 className="mt-6 mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">By Source</h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {Object.entries(data.recentForm.bySource).map(([src, form]) => (
                <RecentFormTable key={src} title={src} form={form} />
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Score Quality */}
      <Card title="Score Quality">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="text-sm text-gray-400">
            Score-Outcome Correlation: <CorrelationBadge value={data.scoreQuality.scoreVsOutcome.correlation} />
          </div>
          <div className="text-xs text-gray-500">
            n={data.scoreQuality.scoreVsOutcome.sampleSize ?? 0}
            {data.scoreQuality.scoreVsOutcome.confidence && data.scoreQuality.scoreVsOutcome.confidence !== 'none' && (
              <span className="ml-1 text-gray-600">({data.scoreQuality.scoreVsOutcome.confidence} confidence)</span>
            )}
          </div>
          {data.scoreQuality.scoreVsOutcome.avgScoreWins != null && (
            <div className="text-xs text-gray-500">
              Avg score on wins: <span className="text-emerald-400 font-medium">{data.scoreQuality.scoreVsOutcome.avgScoreWins.toFixed(1)}</span>
              {' / '}
              losses: <span className="text-red-400 font-medium">{data.scoreQuality.scoreVsOutcome.avgScoreLosses?.toFixed(1) ?? '—'}</span>
            </div>
          )}
          {data.insights.bestScoreBand && (
            <div className="text-xs text-gray-500">
              Best band: <span className="text-emerald-400 font-medium">{data.insights.bestScoreBand.range}</span>
              {' '}({data.insights.bestScoreBand.roiPct >= 0 ? '+' : ''}{data.insights.bestScoreBand.roiPct.toFixed(1)}% ROI)
            </div>
          )}
        </div>

        {data.scoreQuality.bands.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Score Band</th>
                  <th className="py-2 pr-3">Picks</th>
                  <th className="py-2 pr-3">Record</th>
                  <th className="py-2 pr-3">Hit Rate</th>
                  <th className="py-2">ROI</th>
                </tr>
              </thead>
              <tbody>
                {data.scoreQuality.bands.map((band) => (
                  <tr key={band.range} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="py-2 pr-3 text-xs font-medium text-gray-200">{band.range}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{band.total}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">
                      <span className="text-emerald-400">{band.wins}</span>-
                      <span className="text-red-400">{band.losses}</span>-
                      <span className="text-gray-400">{band.pushes}</span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{band.hitRatePct.toFixed(1)}%</td>
                    <td className={`py-2 text-xs font-medium ${band.roiPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {band.roiPct >= 0 ? '+' : ''}{band.roiPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Decision Quality */}
      <Card title="Decision Quality">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricsCard
            label="Approved Win Rate"
            value={data.decisionQuality.approvedWinRate != null ? `${data.decisionQuality.approvedWinRate.toFixed(1)}%` : '—'}
            trend={data.decisionQuality.approvedWinRate != null ? ((data.decisionQuality.approvedWinRate >= 50) ? 'up' : 'down') : undefined}
          />
          <MetricsCard
            label="Denied Would-Have-Won"
            value={data.decisionQuality.deniedWouldHaveWonRate != null ? `${data.decisionQuality.deniedWouldHaveWonRate.toFixed(1)}%` : '—'}
            trend={data.decisionQuality.deniedWouldHaveWonRate != null ? ((data.decisionQuality.deniedWouldHaveWonRate < 50) ? 'up' : 'down') : undefined}
            trendLabel="Lower is better"
          />
          <MetricsCard
            label="Approved vs Denied ROI Delta"
            value={`${data.decisionQuality.approvedVsDeniedRoiDelta >= 0 ? '+' : ''}${data.decisionQuality.approvedVsDeniedRoiDelta.toFixed(1)}%`}
            trend={data.decisionQuality.approvedVsDeniedRoiDelta > 0 ? 'up' : data.decisionQuality.approvedVsDeniedRoiDelta < 0 ? 'down' : 'flat'}
            trendLabel="Positive = decisions adding value"
          />
          <MetricsCard
            label="Holds Resolved"
            value={`${data.decisionQuality.holdsResolvedCount} / ${data.decisionQuality.holdsTotal}`}
          />
        </div>
      </Card>

      {/* Feedback Loop */}
      {data.feedbackLoop.length > 0 && (
        <Card title="Feedback Loop (Recent 50)">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Pick</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Sport</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Decision</th>
                  <th className="py-2 pr-3">Result</th>
                  <th className="py-2 pr-3">Score Call</th>
                  <th className="py-2">Decision Call</th>
                </tr>
              </thead>
              <tbody>
                {data.feedbackLoop.map((entry) => (
                  <tr key={entry.pickId} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="py-2 pr-3 text-xs text-gray-400 font-mono">{entry.pickId.slice(0, 8)}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{entry.source}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{entry.sport}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{entry.promotionScore?.toFixed(1) ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{entry.reviewDecision ?? '—'}</td>
                    <td className={`py-2 pr-3 text-xs font-medium ${entry.result === 'win' ? 'text-emerald-400' : entry.result === 'loss' ? 'text-red-400' : 'text-gray-300'}`}>
                      {entry.result}
                    </td>
                    <td className="py-2 pr-3"><ScoreSignalBadge value={entry.scoreSignal} /></td>
                    <td className="py-2"><RightWrongBadge value={entry.reviewWasRight} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
