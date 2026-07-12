/**
 * UTV2-1522 — Pick-detail line-movement chart. Zero-dependency inline SVG over
 * provider_offer_history-backed series. Fail-closed: unresolved identity or an
 * empty window renders an explicit designed state, never fabricated points.
 */
import type { PickLineMovementResult, LineMovementSeries } from '@/lib/data/odds-intel';

const SERIES_COLORS = ['#3d8bff', '#22c55e', '#f59e0b', '#e879f9', '#94a3b8'];

const W = 640;
const H = 160;
const PAD = { top: 10, right: 16, bottom: 22, left: 40 };

function fmtTime(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function buildScaledPath(
  points: Array<{ t: number; v: number }>,
  tMin: number,
  tMax: number,
  vMin: number,
  vMax: number,
): string {
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const tRange = tMax - tMin || 1;
  const vRange = vMax - vMin || 1;
  return points
    .map((p, i) => {
      const x = PAD.left + ((p.t - tMin) / tRange) * iw;
      const y = PAD.top + ih - ((p.v - vMin) / vRange) * ih;
      return `${i === 0 ? 'M' : 'L'} ${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`;
    })
    .join(' ');
}

function ChartFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-950/60 p-4">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">Line Movement</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function LineMovementChart({
  result,
  pickLine,
  pickSide,
}: {
  result: PickLineMovementResult;
  /** The pick's own line — when known, the chart plots per-book over-odds AT that line (books quote multiple alternate lines concurrently, so raw line-value mixing is misleading). */
  pickLine?: number | null;
  pickSide?: string | null;
}) {
  if (result.status === 'unresolved') {
    return (
      <ChartFrame>
        <div className="flex h-24 flex-col items-center justify-center gap-1 rounded border border-dashed border-gray-800 text-center">
          <p className="text-xs font-medium text-gray-400">Chart contract pending</p>
          <p className="max-w-md text-[11px] text-gray-600">
            Movement cannot be charted for this pick — missing: {result.missing.join('; ')}. No
            points are fabricated.
          </p>
        </div>
      </ChartFrame>
    );
  }
  if (result.status === 'error') {
    return (
      <ChartFrame>
        <div className="flex h-24 items-center justify-center rounded border border-dashed border-gray-800">
          <p className="text-[11px] text-gray-500">provider_offer_history query failed — retry or check DB health.</p>
        </div>
      </ChartFrame>
    );
  }
  if (result.status === 'empty') {
    return (
      <ChartFrame>
        <div className="flex h-24 flex-col items-center justify-center gap-1 rounded border border-dashed border-gray-800 text-center">
          <p className="text-xs font-medium text-gray-400">No history rows for this market</p>
          <p className="text-[11px] text-gray-600">
            Event <span className="cc-num">{result.externalEventId}</span> has no
            provider_offer_history rows for the resolved market key in the scanned window.
          </p>
        </div>
      </ChartFrame>
    );
  }

  // ok: when the pick's line is known, chart per-book OVER odds at exactly
  // that line (books quote several alternate lines concurrently — mixing them
  // zig-zags meaninglessly). Otherwise fall back to line value per book.
  const atPickLine = pickLine !== null && pickLine !== undefined;
  const chartSeries: Array<{ book: string; pts: Array<{ t: number; v: number }> }> = [];
  for (const s of result.series as LineMovementSeries[]) {
    const pts = s.points
      .filter((p) => (atPickLine ? p.line === pickLine && p.overOdds !== null : p.line !== null))
      .map((p) => ({ t: p.t, v: (atPickLine ? p.overOdds : p.line) as number }));
    if (pts.length >= 2) chartSeries.push({ book: s.book, pts });
    if (chartSeries.length >= 5) break;
  }

  if (chartSeries.length === 0) {
    return (
      <ChartFrame>
        <div className="flex h-24 items-center justify-center rounded border border-dashed border-gray-800">
          <p className="text-[11px] text-gray-500">
            History exists but no book has ≥2 line points — nothing to chart honestly.
          </p>
        </div>
      </ChartFrame>
    );
  }

  const allPts = chartSeries.flatMap((s) => s.pts);
  const tMin = Math.min(...allPts.map((p) => p.t));
  const tMax = Math.max(...allPts.map((p) => p.t));
  const vMin = Math.min(...allPts.map((p) => p.v));
  const vMax = Math.max(...allPts.map((p) => p.v));
  const ih = H - PAD.top - PAD.bottom;
  const vRange = vMax - vMin || 1;

  return (
    <ChartFrame>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Line movement by book">
        {/* gridlines: min / max */}
        {[vMin, vMax].map((v) => {
          const y = PAD.top + ih - ((v - vMin) / vRange) * ih;
          return (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="rgba(148,163,184,0.15)" strokeDasharray="3 4" />
              <text x={PAD.left - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#6f819f" className="cc-num">
                {v}
              </text>
            </g>
          );
        })}
        {chartSeries.map((s, i) => {
          const color = SERIES_COLORS[i % SERIES_COLORS.length];
          const last = s.pts[s.pts.length - 1]!;
          const y = PAD.top + ih - ((last.v - vMin) / vRange) * ih;
          return (
            <g key={s.book}>
              <path d={buildScaledPath(s.pts, tMin, tMax, vMin, vMax)} fill="none" stroke={color} strokeWidth="1.5" />
              <circle
                cx={PAD.left + ((last.t - tMin) / (tMax - tMin || 1)) * (W - PAD.left - PAD.right)}
                cy={y}
                r="2.5"
                fill={color}
              />
            </g>
          );
        })}
        <text x={PAD.left} y={H - 6} fontSize="9" fill="#6f819f" className="cc-num">
          {fmtTime(tMin)}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="9" fill="#6f819f" className="cc-num">
          {fmtTime(tMax)}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {chartSeries.map((s, i) => {
          const color = SERIES_COLORS[i % SERIES_COLORS.length];
          const last = s.pts[s.pts.length - 1]!;
          return (
            <span key={s.book} className="inline-flex items-center gap-1.5 text-[10px]" style={{ color }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
              {s.book} <span className="cc-num">{last.v}</span>
            </span>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-gray-600">
        {atPickLine
          ? `Over odds per book at the pick's line (${pickLine}${pickSide ? `, pick is ${pickSide}` : ''}) from provider_offer_history for event `
          : 'Line value per book from provider_offer_history for event '}
        <span className="cc-num">{result.externalEventId}</span>. Books capped at 5, ranked by
        snapshot depth.
      </p>
    </ChartFrame>
  );
}
