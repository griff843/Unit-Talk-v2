import type { ScoreBreakdownRow } from '@/lib/types';

interface ScoreBreakdownBarProps {
  breakdown: ScoreBreakdownRow;
}

const COMPONENT_COLORS: Record<keyof ScoreBreakdownRow['componentsWeighted'], string> = {
  edge: 'bg-blue-500',
  trust: 'bg-violet-500',
  readiness: 'bg-cyan-500',
  uniqueness: 'bg-gray-400',
  boardFit: 'bg-indigo-500',
};

const COMPONENT_LABELS: Record<keyof ScoreBreakdownRow['componentsWeighted'], string> = {
  edge: 'Edge',
  trust: 'Trust',
  readiness: 'Ready',
  uniqueness: 'Unique',
  boardFit: 'Board',
};

type ComponentKey = keyof ScoreBreakdownRow['componentsWeighted'];
const COMPONENT_KEYS: ComponentKey[] = ['edge', 'trust', 'readiness', 'uniqueness', 'boardFit'];

export function ScoreBreakdownBar({ breakdown }: ScoreBreakdownBarProps) {
  const {
    pickId,
    totalScore,
    threshold,
    qualifiedOnScore,
    componentsWeighted,
    thresholdDelta,
    status,
  } = breakdown;

  const shortId = pickId.length > 12 ? `…${pickId.slice(-10)}` : pickId;

  // Scale bar: max total is 100, so each component's width is proportional
  const maxScore = 100;

  const thresholdPct = (threshold / maxScore) * 100;

  return (
    <div className="rounded-lg bg-gray-800/50 border border-gray-700/50 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-gray-400">{shortId}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{status}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
              qualifiedOnScore
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-red-500/20 text-red-400'
            }`}
          >
            {qualifiedOnScore ? 'Qualified' : 'Not Qualified'}
          </span>
        </div>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-bold text-white tabular-nums">
          {totalScore.toFixed(1)}
        </span>
        <span className="text-xs text-gray-500">
          / {threshold} threshold
          {thresholdDelta >= 0
            ? <span className="text-emerald-400 ml-1">+{thresholdDelta.toFixed(1)}</span>
            : <span className="text-red-400 ml-1">{thresholdDelta.toFixed(1)}</span>}
        </span>
      </div>

      {/* Stacked bar */}
      <div className="relative h-3 w-full rounded-full bg-gray-700 overflow-hidden">
        {COMPONENT_KEYS.reduce<{ segments: React.ReactNode[]; offset: number }>(
          ({ segments, offset }, key) => {
            const raw = componentsWeighted[key];
            const widthPct = (raw / maxScore) * 100;
            if (widthPct <= 0) return { segments, offset };
            segments.push(
              <div
                key={key}
                className={`absolute inset-y-0 ${COMPONENT_COLORS[key]}`}
                style={{ left: `${offset}%`, width: `${widthPct}%` }}
                title={`${COMPONENT_LABELS[key]}: ${raw.toFixed(1)}`}
              />,
            );
            return { segments, offset: offset + widthPct };
          },
          { segments: [], offset: 0 },
        ).segments}
        {/* Threshold marker */}
        <div
          className="absolute inset-y-0 w-0.5 bg-white/60"
          style={{ left: `${thresholdPct}%` }}
          title={`Threshold: ${threshold}`}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {COMPONENT_KEYS.map((key) => (
          <span key={key} className="flex items-center gap-1 text-xs text-gray-500">
            <span className={`inline-block h-2 w-2 rounded-sm ${COMPONENT_COLORS[key]}`} />
            {COMPONENT_LABELS[key]}: {componentsWeighted[key].toFixed(1)}
          </span>
        ))}
      </div>
    </div>
  );
}
