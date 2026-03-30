import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { LifecycleSignal } from '@/lib/types';

const SIGNAL_LABELS: Record<LifecycleSignal['signal'], string> = {
  submission: 'Submission',
  scoring: 'Scoring',
  promotion: 'Promotion',
  discord_delivery: 'Discord Delivery',
  settlement: 'Settlement',
  stats_propagation: 'Stats Propagation',
};

export function HealthSignalsPanel({ signals }: { signals: LifecycleSignal[] }) {
  return (
    <Card title="System Health">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {signals.map((s) => (
          <div key={s.signal} className="flex flex-col gap-1 rounded border border-gray-700 bg-gray-800 p-3">
            <span className="text-xs text-gray-400">{SIGNAL_LABELS[s.signal]}</span>
            <StatusBadge status={s.status} />
            <span className="text-xs text-gray-500">{s.detail}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
