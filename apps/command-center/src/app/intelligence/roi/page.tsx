import { getPerformanceData } from '@/lib/data';

interface Stats {
  total: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  avgScore: number | null;
  avgClvPct: number | null;
  avgStakeUnits: number | null;
}

interface PerformanceData {
  windows: { today: Stats; last7d: Stats; last30d: Stats; mtd: Stats };
  bySource: { capper: Stats; system: Stats };
  bySport: Record<string, Stats>;
  byIndividualSource: Record<string, Stats>;
  decisions: { approved: Stats; denied: Stats; held: Stats; heldCount: number };
}

function fmt(n: number | null | undefined, fallback = '—'): string {
  if (n == null || !Number.isFinite(n)) return fallback;
  return n.toFixed(1);
}

function roiColor(roi: number | null): string {
  if (roi == null) return 'text-gray-400';
  return roi >= 0 ? 'text-emerald-400' : 'text-red-400';
}

function fmtRoi(roi: number | null): string {
  if (roi == null || !Number.isFinite(roi)) return '—';
  return `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`;
}

function RoiRow({ label, stats }: { label: string; stats: Stats | null }) {
  if (!stats || stats.settled === 0) return null;
  return (
    <tr className="border-b border-gray-800/50">
      <td className="py-2 pr-4 text-sm text-gray-300">{label}</td>
      <td className={`py-2 pr-4 text-sm font-bold ${roiColor(stats.roiPct)}`}>{fmtRoi(stats.roiPct)}</td>
      <td className="py-2 pr-4 text-sm text-gray-400">{fmt(stats.hitRatePct)}%</td>
      <td className="py-2 pr-4 text-sm text-gray-400">{stats.settled}</td>
      <td className="py-2 pr-4 text-sm text-gray-400">
        <span className="text-emerald-400">{stats.wins}</span>-
        <span className="text-red-400">{stats.losses}</span>-
        <span className="text-gray-300">{stats.pushes}</span>
      </td>
      <td className={`py-2 text-sm ${roiColor(stats.avgClvPct ?? null)}`}>{stats.avgClvPct != null ? fmtRoi(stats.avgClvPct) : '—'}</td>
    </tr>
  );
}

function TableHeader() {
  return (
    <thead>
      <tr className="border-b border-gray-700 text-xs uppercase text-gray-500">
        <th className="pb-2 pr-4 text-left font-medium">Segment</th>
        <th className="pb-2 pr-4 text-left font-medium">ROI</th>
        <th className="pb-2 pr-4 text-left font-medium">Hit Rate</th>
        <th className="pb-2 pr-4 text-left font-medium">Settled</th>
        <th className="pb-2 pr-4 text-left font-medium">Record</th>
        <th className="pb-2 text-left font-medium">CLV%</th>
      </tr>
    </thead>
  );
}

export default async function RoiOverviewPage() {
  const perf = await getPerformanceData() as PerformanceData | null;

  if (!perf) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Intelligence</p>
        <h1 className="text-xl font-bold text-white">ROI Overview</h1>
        <div className="rounded-md border border-gray-700 bg-gray-900/50 px-4 py-6 text-center">
          <p className="text-sm text-gray-400">Unable to load performance data.</p>
          <p className="text-xs text-gray-600 mt-1">Ensure operator-web is running.</p>
        </div>
      </div>
    );
  }

  const { windows, bySource, bySport, byIndividualSource, decisions } = perf;
  const sportEntries = Object.entries(bySport).filter(([, s]) => s.settled > 0);
  const capperEntries = Object.entries(byIndividualSource).filter(([, s]) => s.settled > 0);

  const hasData = windows.last30d.settled > 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Intelligence</p>
        <h1 className="text-xl font-bold text-white">ROI Overview</h1>
      </div>

      {!hasData ? (
        <div className="rounded-md border border-gray-700 bg-gray-900/50 px-4 py-6 text-center">
          <p className="text-sm text-gray-400">No settled picks yet.</p>
          <p className="text-xs text-gray-600 mt-1">ROI breakdown appears after picks are settled.</p>
        </div>
      ) : (
        <>
          {/* ROI by Time Window */}
          <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">By Time Window</h2>
            <table className="w-full">
              <TableHeader />
              <tbody>
                <RoiRow label="Today" stats={windows.today} />
                <RoiRow label="Last 7 Days" stats={windows.last7d} />
                <RoiRow label="Last 30 Days" stats={windows.last30d} />
                <RoiRow label="Month to Date" stats={windows.mtd} />
              </tbody>
            </table>
          </div>

          {/* ROI by Source Type */}
          <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">By Source</h2>
            <table className="w-full">
              <TableHeader />
              <tbody>
                <RoiRow label="Capper" stats={bySource.capper} />
                <RoiRow label="System" stats={bySource.system} />
              </tbody>
            </table>
          </div>

          {/* ROI by Decision */}
          <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">By Decision</h2>
            <table className="w-full">
              <TableHeader />
              <tbody>
                <RoiRow label="Approved" stats={decisions.approved} />
                <RoiRow label="Denied" stats={decisions.denied} />
                <RoiRow label="Held" stats={decisions.held} />
              </tbody>
            </table>
          </div>

          {/* ROI by Sport */}
          {sportEntries.length > 0 && (
            <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">By Sport</h2>
              <table className="w-full">
                <TableHeader />
                <tbody>
                  {sportEntries
                    .sort(([, a], [, b]) => (b.roiPct ?? 0) - (a.roiPct ?? 0))
                    .map(([sport, stats]) => (
                      <RoiRow key={sport} label={sport} stats={stats} />
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ROI by Individual Capper */}
          {capperEntries.length > 0 && (
            <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">By Capper</h2>
              <table className="w-full">
                <TableHeader />
                <tbody>
                  {capperEntries
                    .sort(([, a], [, b]) => (b.roiPct ?? 0) - (a.roiPct ?? 0))
                    .map(([capper, stats]) => (
                      <RoiRow key={capper} label={capper} stats={stats} />
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
