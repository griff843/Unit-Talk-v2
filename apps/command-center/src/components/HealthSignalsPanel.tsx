import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { LifecycleSignal } from '@/lib/types';
import Link from 'next/link';

const SIGNAL_LABELS: Record<LifecycleSignal['signal'], string> = {
  submission: 'Submission',
  scoring: 'Scoring',
  promotion: 'Promotion',
  discord_delivery: 'Discord Delivery',
  settlement: 'Settlement',
  stats_propagation: 'Stats Propagation',
};

interface HealthSignalsPanelProps {
  signals: LifecycleSignal[];
  /** Optional map from signal name to a drilldown URL */
  drilldownLinks?: Partial<Record<LifecycleSignal['signal'], string>>;
}

export function HealthSignalsPanel({ signals, drilldownLinks }: HealthSignalsPanelProps) {
  return (
    <Card title="System Health">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {signals.map((s) => {
          const href = drilldownLinks?.[s.signal];
          const content = (
            <>
              <span className="text-xs text-gray-400">{SIGNAL_LABELS[s.signal]}</span>
              <StatusBadge status={s.status} />
              <span className={`text-xs ${href ? 'text-blue-400 group-hover:underline' : 'text-gray-500'}`}>{s.detail}</span>
            </>
          );

          if (href) {
            return (
              <Link
                key={s.signal}
                href={href}
                className="group flex flex-col gap-1 rounded border border-gray-700 bg-gray-800 p-3 transition-colors hover:border-gray-600 hover:bg-gray-750"
              >
                {content}
              </Link>
            );
          }

          return (
            <div key={s.signal} className="flex flex-col gap-1 rounded border border-gray-700 bg-gray-800 p-3">
              {content}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
