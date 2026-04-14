import type { CapStatus } from '@/lib/types';

interface BoardCapacityGaugeProps {
  label: string;
  current: number;
  cap: number;
  utilization: number;
  status: CapStatus;
}

const STATUS_COLORS: Record<CapStatus, string> = {
  'open': 'bg-emerald-500',
  'near-cap': 'bg-amber-400',
  'at-cap': 'bg-red-500',
};

const STATUS_TEXT: Record<CapStatus, string> = {
  'open': 'text-emerald-400',
  'near-cap': 'text-amber-400',
  'at-cap': 'text-red-400',
};

export function BoardCapacityGauge({
  label,
  current,
  cap,
  utilization,
  status,
}: BoardCapacityGaugeProps) {
  const pct = Math.min(Math.round(utilization * 100), 100);
  const barColor = STATUS_COLORS[status];
  const textColor = STATUS_TEXT[status];

  return (
    <div className="rounded-lg bg-gray-800/50 border border-gray-700/50 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">{label}</span>
        <span className={`text-xs font-semibold uppercase tracking-wide ${textColor}`}>
          {status}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-white tabular-nums">{current}</span>
        <span className="text-sm text-gray-500 mb-0.5">/ {cap}</span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-gray-700">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 text-right">{pct}% utilized</p>
    </div>
  );
}
