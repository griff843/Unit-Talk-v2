import type { SignalStatus } from '@/lib/types';

const colors: Record<SignalStatus, string> = {
  WORKING: 'bg-green-500 text-white',
  DEGRADED: 'bg-yellow-400 text-black',
  BROKEN: 'bg-red-600 text-white',
};

export function StatusBadge({ status }: { status: SignalStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${colors[status]}`}>
      {status}
    </span>
  );
}
