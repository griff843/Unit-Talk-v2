type HealthStatus = 'healthy' | 'warning' | 'error' | 'unknown';

interface HealthBadgeProps {
  status: HealthStatus;
  label?: string;
}

const statusStyles: Record<HealthStatus, string> = {
  healthy: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  warning: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  error: 'bg-red-500/20 text-red-400 border border-red-500/30',
  unknown: 'bg-gray-700/40 text-gray-400 border border-gray-700',
};

const defaultLabels: Record<HealthStatus, string> = {
  healthy: 'Healthy',
  warning: 'Warning',
  error: 'Error',
  unknown: 'Unknown',
};

export function HealthBadge({ status, label }: HealthBadgeProps) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${statusStyles[status]}`}
    >
      {label ?? defaultLabels[status]}
    </span>
  );
}
