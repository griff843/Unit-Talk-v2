import { Card } from '@/components/ui/Card';
import Link from 'next/link';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

interface Stats {
  total: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  avgScore: number | null;
}

interface PerformanceData {
  windows: { today: Stats; last7d: Stats; last30d: Stats; mtd: Stats };
  bySource: { capper: Stats; system: Stats };
  bySport: Record<string, Stats>;
  decisions: { approved: Stats; denied: Stats; heldCount: number };
  insights: {
    capperRoiPct: number;
    systemRoiPct: number;
    approvedRoiPct: number;
    deniedRoiPct: number;
    topCapper: { name: string; roiPct: number };
    worstSegment: { name: string; roiPct: number };
  };
}

interface LeaderboardRow {
  capper: string;
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  avgClvPct: number | null;
}

async function fetchPerformance(): Promise<PerformanceData | null> {
  try {
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/performance`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data: PerformanceData };
    return json.ok ? json.data : null;
  } catch {
    return null;
  }
}

async function fetchLeaderboard(window: number): Promise<LeaderboardRow[]> {
  try {
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/leaderboard?last=${window}&limit=25`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as { ok: boolean; data: { rows: Array<Record<string, unknown>> } };
    if (!json.ok) return [];
    return (json.data.rows ?? []).map((r) => ({
      capper: String(r['capper'] ?? 'unknown'),
      total: Number(r['totalPicks'] ?? 0),
      wins: Number(r['wins'] ?? 0),
      losses: Number(r['losses'] ?? 0),
      pushes: Number(r['pushes'] ?? 0),
      hitRatePct: Number(r['hitRatePct'] ?? 0),
      roiPct: Number(r['roiPct'] ?? 0),
      avgClvPct: r['avgClvPct'] != null ? Number(r['avgClvPct']) : null,
    }));
  } catch {
    return [];
  }
}

function StatCard({ label, stats }: { label: string; stats: Stats | null }) {
  if (!stats) return (
    <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className="mt-2 text-sm text-gray-500">No data</p>
    </div>
  );

  return (
    <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <div className="mt-3 grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
        <div><span className="text-gray-400">Total</span> <span className="font-bold">{stats.total}</span></div>
        <div>
          <span className="text-gray-400">Record</span>{' '}
          <span className="font-bold">
            <span className="text-emerald-400">{stats.wins}</span>-
            <span className="text-red-400">{stats.losses}</span>-
            <span className="text-gray-300">{stats.pushes}</span>
          </span>
        </div>
        <div><span className="text-gray-400">Hit Rate</span> <span className="font-bold">{stats.hitRatePct.toFixed(1)}%</span></div>
        <div>
          <span className="text-gray-400">ROI</span>{' '}
          <span className={`font-bold ${stats.roiPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {stats.roiPct >= 0 ? '+' : ''}{stats.roiPct.toFixed(1)}%
          </span>
        </div>
        {stats.avgScore != null && (
          <div><span className="text-gray-400">Avg Score</span> <span className="font-bold">{stats.avgScore.toFixed(1)}</span></div>
        )}
      </div>
    </div>
  );
}

function InsightRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between py-1.5 text-sm border-b border-gray-800 last:border-0">
      <span className="text-gray-400">{label}</span>
      <span className={`font-medium ${color ?? 'text-gray-200'}`}>{value}</span>
    </div>
  );
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const windowParam = searchParams['window'];
  const window = windowParam === '7' ? 7 : windowParam === '90' ? 90 : 30;

  const [perf, leaderboard] = await Promise.all([
    fetchPerformance(),
    fetchLeaderboard(window),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-bold text-gray-100">Performance</h1>

      {/* Time window summaries */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Today" stats={perf?.windows.today ?? null} />
        <StatCard label="Last 7 Days" stats={perf?.windows.last7d ?? null} />
        <StatCard label="Last 30 Days" stats={perf?.windows.last30d ?? null} />
        <StatCard label="Month to Date" stats={perf?.windows.mtd ?? null} />
      </div>

      {/* Source split + Decision outcomes side by side */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Capper Picks" stats={perf?.bySource.capper ?? null} />
        <StatCard label="System Picks" stats={perf?.bySource.system ?? null} />
        <StatCard label="Approved (outcome)" stats={perf?.decisions.approved ?? null} />
        <StatCard label="Denied (counterfactual)" stats={perf?.decisions.denied ?? null} />
      </div>

      {/* Sport breakdown */}
      {perf && Object.keys(perf.bySport).length > 0 && (
        <Card title="By Sport">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {Object.entries(perf.bySport).map(([sport, stats]) => (
              <StatCard key={sport} label={sport} stats={stats} />
            ))}
          </div>
        </Card>
      )}

      {/* Operator Insight Panel */}
      {perf && (
        <Card title="Operator Insights">
          <div className="max-w-md">
            <InsightRow
              label="System vs Capper ROI"
              value={`System ${perf.insights.systemRoiPct >= 0 ? '+' : ''}${perf.insights.systemRoiPct.toFixed(1)}% / Capper ${perf.insights.capperRoiPct >= 0 ? '+' : ''}${perf.insights.capperRoiPct.toFixed(1)}%`}
            />
            <InsightRow
              label="Approved vs Denied"
              value={`Approved ${perf.insights.approvedRoiPct >= 0 ? '+' : ''}${perf.insights.approvedRoiPct.toFixed(1)}% / Denied ${perf.insights.deniedRoiPct >= 0 ? '+' : ''}${perf.insights.deniedRoiPct.toFixed(1)}%`}
            />
            <InsightRow
              label="Held picks"
              value={`${perf.decisions.heldCount} unresolved`}
              color={perf.decisions.heldCount > 0 ? 'text-yellow-400' : 'text-gray-300'}
            />
            <InsightRow label="Top capper" value={`${perf.insights.topCapper.name} (${perf.insights.topCapper.roiPct >= 0 ? '+' : ''}${perf.insights.topCapper.roiPct.toFixed(1)}%)`} color="text-emerald-400" />
            <InsightRow label="Worst segment" value={`${perf.insights.worstSegment.name} (${perf.insights.worstSegment.roiPct >= 0 ? '+' : ''}${perf.insights.worstSegment.roiPct.toFixed(1)}%)`} color="text-red-400" />
          </div>
        </Card>
      )}

      {/* Leaderboard */}
      <Card title={`Capper Leaderboard (${window}d)`}>
        <div className="mb-3 flex gap-2">
          {[7, 30, 90].map((w) => (
            <Link
              key={w}
              href={`/performance?window=${w}`}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${w === window ? 'bg-blue-600 text-white' : 'border border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
            >
              {w}d
            </Link>
          ))}
        </div>

        {leaderboard.length === 0 ? (
          <p className="text-sm text-gray-500">No capper data available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Capper</th>
                  <th className="py-2 pr-3">Picks</th>
                  <th className="py-2 pr-3">Record</th>
                  <th className="py-2 pr-3">Hit Rate</th>
                  <th className="py-2 pr-3">ROI</th>
                  <th className="py-2">CLV%</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row, i) => (
                  <tr key={row.capper} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="py-2 pr-3 text-xs text-gray-500">{i + 1}</td>
                    <td className="py-2 pr-3 text-xs font-medium text-gray-200">{row.capper}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{row.total}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">
                      <span className="text-emerald-400">{row.wins}</span>-
                      <span className="text-red-400">{row.losses}</span>-
                      <span className="text-gray-400">{row.pushes}</span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{row.hitRatePct.toFixed(1)}%</td>
                    <td className={`py-2 pr-3 text-xs font-medium ${row.roiPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {row.roiPct >= 0 ? '+' : ''}{row.roiPct.toFixed(1)}%
                    </td>
                    <td className="py-2 text-xs text-gray-300">
                      {row.avgClvPct != null ? `${row.avgClvPct.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
