import { Card, EmptyState } from '@/components/ui';
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

async function fetchPerformance(): Promise<PerformanceData | null> {
  try {
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/performance`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data: PerformanceData };
    return json.ok ? json.data : null;
  } catch {
    return null;
  }
}

function fmt(n: number | null | undefined, fallback = '—'): string {
  if (n == null || !Number.isFinite(n)) return fallback;
  return n.toFixed(1);
}

const MIN_SETTLED_FOR_DISPLAY = 10;

function HitRateBar({
  label,
  stats,
}: {
  label: string;
  stats: Stats;
}) {
  const settled = stats.wins + stats.losses + stats.pushes;
  if (settled === 0) return null;

  const pct = stats.hitRatePct;
  const barColor =
    pct >= 55 ? 'bg-emerald-500' : pct >= 45 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
      <span className="w-32 shrink-0 text-xs text-gray-300 truncate" title={label}>
        {label}
      </span>
      <div className="flex-1 h-4 bg-gray-800 rounded overflow-hidden">
        <div
          className={`h-full ${barColor} rounded transition-all`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="w-14 text-right text-xs font-medium text-gray-200">
        {fmt(pct)}%
      </span>
      <span className="w-20 text-right text-xs text-gray-500">
        <span className="text-emerald-400">{stats.wins}</span>-
        <span className="text-red-400">{stats.losses}</span>-
        <span className="text-gray-400">{stats.pushes}</span>
      </span>
      <span className="w-12 text-right text-[10px] text-gray-600">n={settled}</span>
    </div>
  );
}

export default async function HitRatePage() {
  const perf = await fetchPerformance();

  if (!perf) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
          <h1 className="mt-1 text-xl font-bold text-white">Hit Rate</h1>
        </div>
        <EmptyState
          message="Unable to load performance data."
          detail="Check that operator-web is reachable and the /api/operator/performance endpoint is responding."
          action={{ label: 'Back to Research', href: '/research' }}
        />
      </div>
    );
  }

  const overallSettled =
    perf.windows.last30d.wins +
    perf.windows.last30d.losses +
    perf.windows.last30d.pushes;

  if (overallSettled < MIN_SETTLED_FOR_DISPLAY) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
          <h1 className="mt-1 text-xl font-bold text-white">Hit Rate</h1>
        </div>
        <div className="rounded-md border border-yellow-800 bg-yellow-950/30 px-4 py-3">
          <p className="text-sm font-medium text-yellow-400">Insufficient settlement volume</p>
          <p className="text-xs text-yellow-600 mt-1">
            Hit rate displays require at least {MIN_SETTLED_FOR_DISPLAY} settled picks
            in the 30-day window. Current settled count: {overallSettled}.
          </p>
        </div>
        <Link
          href="/research"
          className="self-start rounded px-3 py-1.5 text-xs font-medium text-blue-400 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
        >
          Back to Research
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Hit Rate</h1>
        <p className="mt-1 text-sm text-gray-400">
          Settlement hit rates from the performance endpoint. Based on {overallSettled} settled
          picks in the last 30 days.
        </p>
      </div>

      {/* Time Window Hit Rates */}
      <Card title="By Time Window">
        <div className="flex flex-col">
          <HitRateBar label="Today" stats={perf.windows.today} />
          <HitRateBar label="Last 7 Days" stats={perf.windows.last7d} />
          <HitRateBar label="Last 30 Days" stats={perf.windows.last30d} />
          <HitRateBar label="Month to Date" stats={perf.windows.mtd} />
        </div>
      </Card>

      {/* Source Split */}
      <Card title="By Source">
        <div className="flex flex-col">
          <HitRateBar label="Capper" stats={perf.bySource.capper} />
          <HitRateBar label="System" stats={perf.bySource.system} />
        </div>
        {Object.keys(perf.byIndividualSource).length > 0 && (
          <>
            <p className="mt-4 mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Individual Sources
            </p>
            <div className="flex flex-col">
              {Object.entries(perf.byIndividualSource).map(([source, stats]) => (
                <HitRateBar key={source} label={source} stats={stats} />
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Sport Split */}
      {Object.keys(perf.bySport).length > 0 && (
        <Card title="By Sport">
          <div className="flex flex-col">
            {Object.entries(perf.bySport).map(([sport, stats]) => (
              <HitRateBar key={sport} label={sport} stats={stats} />
            ))}
          </div>
        </Card>
      )}

      {/* Decision Split */}
      <Card title="By Decision">
        <div className="flex flex-col">
          <HitRateBar label="Approved" stats={perf.decisions.approved} />
          <HitRateBar label="Denied" stats={perf.decisions.denied} />
          <HitRateBar label="Held" stats={perf.decisions.held} />
        </div>
      </Card>
    </div>
  );
}
