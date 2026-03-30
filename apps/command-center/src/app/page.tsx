import { Card } from '@/components/ui/Card';
import { HealthSignalsPanel } from '@/components/HealthSignalsPanel';
import { PickLifecycleTable } from '@/components/PickLifecycleTable';
import type { LifecycleSignal, PickRow, StatsSnapshot } from '@/lib/types';

// Placeholder data until data layer is wired
const PLACEHOLDER_SIGNALS: LifecycleSignal[] = [
  { signal: 'submission', status: 'WORKING', detail: 'Loading...' },
  { signal: 'scoring', status: 'WORKING', detail: 'Loading...' },
  { signal: 'promotion', status: 'WORKING', detail: 'Loading...' },
  { signal: 'discord_delivery', status: 'WORKING', detail: 'Loading...' },
  { signal: 'settlement', status: 'WORKING', detail: 'Loading...' },
  { signal: 'stats_propagation', status: 'WORKING', detail: 'Loading...' },
];

export default function DashboardPage() {
  const signals: LifecycleSignal[] = PLACEHOLDER_SIGNALS;
  const picks: PickRow[] = [];
  const stats: StatsSnapshot = { total: 0, wins: 0, losses: 0, pushes: 0, roiPct: null };

  return (
    <div className="flex flex-col gap-6">
      <HealthSignalsPanel signals={signals} />

      <Card title="Stats Summary">
        <div className="flex gap-6 text-sm">
          <div><span className="text-gray-400">Total</span> <span className="font-bold">{stats.total}</span></div>
          <div><span className="text-gray-400">W</span> <span className="font-bold text-green-400">{stats.wins}</span></div>
          <div><span className="text-gray-400">L</span> <span className="font-bold text-red-400">{stats.losses}</span></div>
          <div><span className="text-gray-400">P</span> <span className="font-bold text-gray-300">{stats.pushes}</span></div>
          <div><span className="text-gray-400">ROI</span> <span className="font-bold">{stats.roiPct != null ? `${stats.roiPct.toFixed(1)}%` : '—'}</span></div>
        </div>
      </Card>

      <Card title="Pick Lifecycle">
        <PickLifecycleTable picks={picks} />
      </Card>
    </div>
  );
}
