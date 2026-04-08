import type { ConflictCard as ConflictCardType, ConflictReason } from '../lib/types.js';

interface ConflictCardProps {
  card: ConflictCardType;
}

const REASON_STYLES: Record<ConflictReason, { label: string; className: string }> = {
  'slate-cap': {
    label: 'Slate Cap',
    className: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  },
  'sport-cap': {
    label: 'Sport Cap',
    className: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  'game-cap': {
    label: 'Game Cap',
    className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  },
  'duplicate': {
    label: 'Duplicate',
    className: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  },
  'other': {
    label: 'Other',
    className: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  },
};

export function ConflictCard({ card }: ConflictCardProps) {
  const { pickId, totalScore, threshold, thresholdDelta, conflictReason, rawReason, sport, decidedAt } = card;

  const shortId = pickId.length > 12 ? `…${pickId.slice(-10)}` : pickId;
  const shortReason = rawReason.length > 80 ? `${rawReason.slice(0, 80)}…` : rawReason;
  const reasonStyle = REASON_STYLES[conflictReason];

  const decisionTime = decidedAt
    ? new Date(decidedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="rounded-lg bg-gray-800/50 border border-gray-700/50 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-gray-400">{shortId}</span>
        <span
          className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${reasonStyle.className}`}
        >
          {reasonStyle.label}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold text-white tabular-nums">{totalScore.toFixed(1)}</span>
        <span className="text-xs text-gray-500">/ {threshold} threshold</span>
        <span className="text-xs font-semibold text-emerald-400">
          +{thresholdDelta.toFixed(1)} above
        </span>
      </div>

      {rawReason && (
        <p className="text-xs text-gray-400 leading-relaxed">{shortReason}</p>
      )}

      <div className="flex items-center gap-3 text-xs text-gray-600">
        {sport && <span>{sport}</span>}
        {decisionTime && <span>{decisionTime}</span>}
      </div>
    </div>
  );
}
