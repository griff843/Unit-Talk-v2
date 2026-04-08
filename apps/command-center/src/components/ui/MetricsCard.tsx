interface MetricsCardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'flat';
  trendLabel?: string;
  loading?: boolean;
}

function TrendArrow({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') {
    return (
      <svg
        className="h-4 w-4 text-emerald-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="18 15 12 9 6 15" />
      </svg>
    );
  }
  if (trend === 'down') {
    return (
      <svg
        className="h-4 w-4 text-red-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    );
  }
  return (
    <svg
      className="h-4 w-4 text-gray-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

const trendTextColor = {
  up: 'text-emerald-400',
  down: 'text-red-400',
  flat: 'text-gray-500',
} as const;

export function MetricsCard({ label, value, trend, trendLabel, loading = false }: MetricsCardProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-5 animate-pulse">
        <div className="mb-3 h-8 w-24 rounded bg-gray-800" />
        <div className="h-3 w-20 rounded bg-gray-800" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-5">
      <div className="mb-1 text-2xl font-bold tabular-nums text-white">{value}</div>
      <div className="text-xs font-medium uppercase tracking-widest text-gray-500">{label}</div>
      {(trend || trendLabel) && (
        <div className={`mt-2 flex items-center gap-1 text-xs ${trend ? trendTextColor[trend] : 'text-gray-500'}`}>
          {trend && <TrendArrow trend={trend} />}
          {trendLabel && <span>{trendLabel}</span>}
        </div>
      )}
    </div>
  );
}
