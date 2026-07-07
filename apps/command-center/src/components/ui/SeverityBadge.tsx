export type Severity = 'critical' | 'warning' | 'needs-pm' | 'info' | 'healthy';

export const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'needs-pm', 'info', 'healthy'];

const styles: Record<Severity, { label: string; className: string }> = {
  critical: { label: 'Critical', className: 'bg-red-500/20 text-red-400 border border-red-500/30' },
  warning: { label: 'Warning', className: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' },
  'needs-pm': { label: 'Needs PM', className: 'bg-violet-500/20 text-violet-300 border border-violet-500/30' },
  info: { label: 'Info', className: 'bg-sky-500/20 text-sky-300 border border-sky-500/30' },
  healthy: { label: 'Healthy', className: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' },
};

export function SeverityBadge({ severity, label }: { severity: Severity; label?: string }) {
  const style = styles[severity];
  return (
    <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-bold ${style.className}`}>
      {label ?? style.label}
    </span>
  );
}
