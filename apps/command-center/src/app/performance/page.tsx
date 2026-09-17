import { Card } from '@/components/ui/Card';
import Link from 'next/link';
import { getPerformanceData, getLeaderboard } from '@/lib/data';
// The canonical shape, imported rather than restated. A local copy of `Stats`
// had drifted from the producer and let a nullable ROI render as a number.
import type { Stats } from '@/lib/data';

export const metadata = { title: 'Performance — Unit Talk Command Center' };

function fmt(n: number | null | undefined, fallback = '—'): string {
  if (n == null || !Number.isFinite(n)) return fallback;
  return n.toFixed(1);
}

/**
 * Render a percentage that may not have been measured.
 *
 * A `null` ROI means nothing in the cohort could be priced. It renders as an
 * em dash, never as "+0.0%" -- the reader must be able to tell "break-even"
 * apart from "we have no idea".
 */
function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function pctTone(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'text-gray-500';
  return n >= 0 ? 'text-emerald-400' : 'text-red-400';
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
        <div><span className="text-gray-400">Hit Rate</span> <span className="font-bold">{fmt(stats.hitRatePct)}%</span></div>
        <div>
          <span className="text-gray-400">ROI</span>{' '}
          <span className={`font-bold ${pctTone(stats.roiPct)}`}>{pct(stats.roiPct)}</span>
        </div>
        {stats.unitsNet != null && (
          <div>
            <span className="text-gray-400">Net Units</span>{' '}
            <span className={`font-bold ${pctTone(stats.unitsNet)}`}>
              {stats.unitsNet >= 0 ? '+' : ''}{stats.unitsNet.toFixed(2)}
            </span>
          </div>
        )}
        {stats.unitsStaked != null && (
          <div><span className="text-gray-400">Units Staked</span> <span className="font-bold">{stats.unitsStaked.toFixed(2)}</span></div>
        )}
        {stats.unpriced > 0 && (
          <div className="col-span-2 text-xs text-yellow-300/80">
            {stats.unpriced} decided pick{stats.unpriced === 1 ? '' : 's'} carried no usable odds or stake and contributed no units.
          </div>
        )}
        {stats.avgScore != null && (
          <div><span className="text-gray-400">Avg Score</span> <span className="font-bold">{fmt(stats.avgScore)}</span></div>
        )}
        {stats.avgClvPct != null && (
          <div>
            <span className="text-gray-400">CLV%</span>{' '}
            <span className={`font-bold ${(stats.avgClvPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {(stats.avgClvPct ?? 0) >= 0 ? '+' : ''}{fmt(stats.avgClvPct)}%
            </span>
          </div>
        )}
        {stats.avgStakeUnits != null && (
          <div><span className="text-gray-400">Avg Units</span> <span className="font-bold">{fmt(stats.avgStakeUnits)}</span></div>
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

function SampleWarning({
  title,
  tone = 'warning',
  children,
}: {
  title: string;
  tone?: 'warning' | 'info';
  children: React.ReactNode;
}) {
  const classes =
    tone === 'warning'
      ? 'border-yellow-800/60 bg-yellow-900/20 text-yellow-100'
      : 'border-blue-800/60 bg-blue-900/20 text-blue-100';

  return (
    <div className={`rounded border p-3 text-xs ${classes}`}>
      <div className="font-medium">{title}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export default async function PerformancePage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const windowParam = searchParams['window'];
  const window = windowParam === '7' ? 7 : windowParam === '90' ? 90 : 30;

  const [perf, leaderboardResult] = await Promise.all([
    getPerformanceData(),
    getLeaderboard(window),
  ]);
  const leaderboard = leaderboardResult.rows;
  const leaderboardError = leaderboardResult.error;
  const leaderboardHasThinSignal = leaderboardError === null && leaderboard.length === 0;
  const heldReviewSignalIsThin =
    (perf?.decisions.approved.total ?? 0) + (perf?.decisions.denied.total ?? 0) + (perf?.decisions.held.total ?? 0) < 10;

  return (
    <div className="flex flex-col gap-6">

      <div className="grid gap-3 lg:grid-cols-2">
        <SampleWarning title="Operator note">
          This page is strongest for trend watching, not absolute certainty. Small samples and unresolved holds can make ROI swings look more meaningful than they are.
        </SampleWarning>
        {heldReviewSignalIsThin && (
          <SampleWarning title="Decision-quality caution" tone="info">
            Approved versus denied comparisons are still based on thin operator-reviewed volume, so treat the delta as directional only.
          </SampleWarning>
        )}
      </div>

      {/* Time window summaries */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Today" stats={perf?.windows.today ?? null} />
        <StatCard label="Last 7 Days" stats={perf?.windows.last7d ?? null} />
        <StatCard label="Last 30 Days" stats={perf?.windows.last30d ?? null} />
        <StatCard label="Month to Date" stats={perf?.windows.mtd ?? null} />
      </div>

      {/* Comparative: Source split */}
      <Card title="Capper vs System">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard label="Capper Picks" stats={perf?.bySource.capper ?? null} />
          <StatCard label="System Picks" stats={perf?.bySource.system ?? null} />
        </div>
      </Card>

      {/* Published per-capper record, and the aggregate it reconciles against */}
      <Card title="Published Record by Capper">
        <div className="mb-3 text-xs text-gray-400">
          Attributed by canonical <code className="text-gray-300">picks.capper_id</code> — never guessed
          from <code className="text-gray-300">picks.source</code>. Track Only picks are excluded here
          because they were never shown to a member; they are reported separately below. The per-capper
          figures and the Unit Talk aggregate are the same function over disjoint partitions of one
          cohort, so they reconcile by construction.
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard label="Unit Talk (all published)" stats={perf?.unitTalkAggregate ?? null} />
          {perf &&
            Object.entries(perf.byCapper).map(([capper, stats]) => (
              <StatCard key={capper} label={capper} stats={stats} />
            ))}
        </div>
        {perf && Object.keys(perf.byCapper).length === 0 && (
          <div className="mt-3 text-sm text-gray-500">
            No published pick carries a canonical capper_id yet. That is a fact about the data, not a
            failed read — nothing is inferred to fill the gap.
          </div>
        )}
      </Card>

      {/* Internal Track Only evidence — never folded into a published figure */}
      {perf && perf.trackOnly.stats.total > 0 && (
        <Card title="Track Only (internal evidence — not published)">
          <div className="mb-3 text-xs text-yellow-300/80">
            These picks persisted and settled but were never delivered to a member. They are shown so an
            operator can see them, and are excluded from every figure above.
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard label="All Track Only" stats={perf.trackOnly.stats} />
            {Object.entries(perf.trackOnly.byCapper).map(([capper, stats]) => (
              <StatCard key={capper} label={`${capper} (track only)`} stats={stats} />
            ))}
          </div>
        </Card>
      )}

      {/* Comparative: Decision outcomes */}
      <Card title="Decision Outcomes">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard label="Approved (outcome)" stats={perf?.decisions.approved ?? null} />
          <StatCard label="Denied (counterfactual)" stats={perf?.decisions.denied ?? null} />
          <StatCard label="Held (outcome)" stats={perf?.decisions.held ?? null} />
        </div>
      </Card>

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

      {/* Per-Source Breakdown */}
      {perf && Object.keys(perf.byIndividualSource).length > 0 && (
        <Card title="By Source">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {Object.entries(perf.byIndividualSource).map(([source, stats]) => (
              <StatCard key={source} label={source} stats={stats} />
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
              value={`System ${pct(perf.insights.systemRoiPct)} / Capper ${pct(perf.insights.capperRoiPct)}`}
            />
            <InsightRow
              label="Approved vs Denied ROI"
              value={`Approved ${pct(perf.insights.approvedRoiPct)} / Denied ${pct(perf.insights.deniedRoiPct)}`}
            />
            <InsightRow
              label="Approved vs Denied Delta"
              value={pct(perf.insights.approvedVsDeniedDelta)}
              color={pctTone(perf.insights.approvedVsDeniedDelta)}
            />
            <InsightRow
              label="Held picks"
              value={`${perf.decisions.heldCount} unresolved`}
              color={perf.decisions.heldCount > 0 ? 'text-yellow-400' : 'text-gray-300'}
            />
            <InsightRow label="Top source" value={`${perf.insights.topCapper.name} (${pct(perf.insights.topCapper.roiPct)}, n=${perf.insights.topCapper.sampleSize})`} color="text-emerald-400" />
            <InsightRow label="Worst source" value={`${perf.insights.worstSegment.name} (${pct(perf.insights.worstSegment.roiPct)}, n=${perf.insights.worstSegment.sampleSize})`} color="text-red-400" />
            <InsightRow label="Strongest sport" value={`${perf.insights.strongestSport.name} (${pct(perf.insights.strongestSport.roiPct)}, n=${perf.insights.strongestSport.sampleSize})`} color="text-emerald-400" />
            <InsightRow label="Weakest sport" value={`${perf.insights.weakestSport.name} (${pct(perf.insights.weakestSport.roiPct)}, n=${perf.insights.weakestSport.sampleSize})`} color="text-red-400" />
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

        {leaderboardError !== null ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <div className="font-semibold">Leaderboard query failed</div>
            <p className="mt-1 font-mono text-xs opacity-85">{leaderboardError}</p>
          </div>
        ) : leaderboard.length === 0 ? (
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
                    <td className={`py-2 pr-3 text-xs font-medium ${pctTone(row.roiPct)}`}>
                      {pct(row.roiPct)}
                      {row.unpriced > 0 ? (
                        <span className="ml-1 text-[10px] text-gray-500">({row.unpriced} unpriced)</span>
                      ) : null}
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
        {leaderboardHasThinSignal && (
          <p className="mt-3 text-xs text-gray-500">
            Leaderboard insight is currently limited because no capper met the display criteria for this window.
          </p>
        )}
      </Card>
    </div>
  );
}
