import { Card } from '@/components/ui/Card';
import Link from 'next/link';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

interface StatsData {
  window: number;
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  avgScore: number | null;
  capperName?: string;
  sport?: string;
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

async function fetchStats(window: number, capper?: string, sport?: string): Promise<StatsData | null> {
  try {
    const params = new URLSearchParams({ last: String(window) });
    if (capper) params.set('capper', capper);
    if (sport) params.set('sport', sport);
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/stats?${params}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    if (!json.ok) return null;
    const d = json.data;
    return {
      window,
      total: Number(d['totalPicks'] ?? 0),
      wins: Number(d['wins'] ?? 0),
      losses: Number(d['losses'] ?? 0),
      pushes: Number(d['pushes'] ?? 0),
      hitRatePct: Number(d['hitRatePct'] ?? 0),
      roiPct: Number(d['roiPct'] ?? 0),
      avgScore: d['avgScore'] != null ? Number(d['avgScore']) : null,
    };
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

function StatCard({ label, stats }: { label: string; stats: StatsData | null }) {
  if (!stats) {
    return (
      <div className="rounded border border-gray-700 bg-gray-900 p-4">
        <p className="text-xs uppercase text-gray-500">{label}</p>
        <p className="mt-2 text-sm text-gray-500">No data</p>
      </div>
    );
  }

  return (
    <div className="rounded border border-gray-700 bg-gray-900 p-4">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <div className="mt-2 grid grid-cols-4 gap-3 text-sm">
        <div>
          <span className="text-gray-400">Total</span>
          <div className="font-bold">{stats.total}</div>
        </div>
        <div>
          <span className="text-gray-400">Record</span>
          <div className="font-bold">
            <span className="text-green-400">{stats.wins}</span>-
            <span className="text-red-400">{stats.losses}</span>-
            <span className="text-gray-300">{stats.pushes}</span>
          </div>
        </div>
        <div>
          <span className="text-gray-400">Hit Rate</span>
          <div className="font-bold">{stats.hitRatePct.toFixed(1)}%</div>
        </div>
        <div>
          <span className="text-gray-400">ROI</span>
          <div className={`font-bold ${stats.roiPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {stats.roiPct >= 0 ? '+' : ''}{stats.roiPct.toFixed(1)}%
          </div>
        </div>
      </div>
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

  const [stats7, stats30, stats90, leaderboard] = await Promise.all([
    fetchStats(7),
    fetchStats(30),
    fetchStats(90),
    fetchLeaderboard(window),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-bold text-gray-100">Performance</h1>

      {/* Time window summaries */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Last 7 Days" stats={stats7} />
        <StatCard label="Last 30 Days" stats={stats30} />
        <StatCard label="Last 90 Days" stats={stats90} />
      </div>

      {/* Leaderboard */}
      <Card title={`Capper Leaderboard (${window}d)`}>
        <div className="mb-3 flex gap-2">
          {[7, 30, 90].map((w) => (
            <Link
              key={w}
              href={`/performance?window=${w}`}
              className={`rounded px-2 py-1 text-xs ${w === window ? 'bg-blue-600 text-white' : 'border border-gray-700 text-gray-400 hover:bg-gray-800'}`}
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
                  <tr key={row.capper} className="border-b border-gray-800">
                    <td className="py-2 pr-3 text-xs text-gray-500">{i + 1}</td>
                    <td className="py-2 pr-3 text-xs font-medium text-gray-200">{row.capper}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{row.total}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">
                      <span className="text-green-400">{row.wins}</span>-
                      <span className="text-red-400">{row.losses}</span>-
                      <span className="text-gray-400">{row.pushes}</span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{row.hitRatePct.toFixed(1)}%</td>
                    <td className={`py-2 pr-3 text-xs font-medium ${row.roiPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
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
