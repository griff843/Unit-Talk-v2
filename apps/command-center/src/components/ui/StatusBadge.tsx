import type { SignalStatus } from '@/lib/types';

const colors: Record<SignalStatus, string> = {
  WORKING: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  DEGRADED: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  BROKEN: 'bg-red-500/20 text-red-400 border border-red-500/30',
};

export function StatusBadge({ status }: { status: SignalStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${colors[status]}`}>
      {status}
    </span>
  );
}
