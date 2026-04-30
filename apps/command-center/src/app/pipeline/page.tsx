import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { getSnapshotData } from '@/lib/data';
import { buildPipelinePageData } from '@/lib/command-center-page-data';
import { Card, PipelineFlow, Sparkline } from '@/components/ui';

function trendLabel(trend: 'up' | 'down' | 'flat') {
  if (trend === 'up') return 'Rising';
  if (trend === 'down') return 'Falling';
  return 'Flat';
}

function trendTone(trend: 'up' | 'down' | 'flat') {
  if (trend === 'up') return 'text-amber-200';
  if (trend === 'down') return 'text-emerald-200';
  return 'text-[var(--cc-text-secondary)]';
}

function rowTone(tone: 'healthy' | 'idle' | 'error') {
  if (tone === 'error') return 'text-rose-200';
  if (tone === 'idle') return 'text-[var(--cc-text-secondary)]';
  return 'text-emerald-200';
}

export default async function PipelinePage() {
  const snapshot = await getSnapshotData();
  const model = buildPipelinePageData(snapshot);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100">Pipeline</h1>
          <p className="text-sm text-gray-500">
            Lifecycle truth from validated intake through posting and settlement.
          </p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={model.observedAt} intervalMs={30_000} className="lg:min-w-[360px]" />
      </div>

      <PipelineFlow stages={model.stages} />

      <div className="grid gap-4 xl:grid-cols-2">
        {[model.backlog, model.promotionQueue].map((card) => (
          <Card key={card.label} title={card.label}>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-3xl font-semibold text-[var(--cc-text-primary)]">{card.value}</div>
                <div className="mt-2 text-sm text-[var(--cc-text-secondary)]">{card.detail}</div>
              </div>
              <div className={`text-sm font-medium uppercase tracking-[0.16em] ${trendTone(card.trend)}`}>
                {trendLabel(card.trend)}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card title="Stage Lag">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-[11px] uppercase tracking-[0.16em] text-gray-500">
                <th className="py-2 pr-4">Stage</th>
                <th className="py-2 pr-4">Current</th>
                <th className="py-2 pr-4">Lag Readout</th>
                <th className="py-2">Recent Sample</th>
              </tr>
            </thead>
            <tbody>
              {model.lagRows.map((row) => (
                <tr key={row.stage} className="border-b border-gray-900">
                  <td className="py-3 pr-4 text-[var(--cc-text-primary)]">{row.stage}</td>
                  <td className={`py-3 pr-4 font-semibold ${rowTone(row.tone)}`}>{row.currentCount}</td>
                  <td className="py-3 pr-4 text-[var(--cc-text-secondary)]">{row.lagLabel}</td>
                  <td className="py-3">
                    <Sparkline
                      points={row.sparkline}
                      label={`${row.stage} lag sample`}
                      strokeClassName={row.tone === 'error' ? 'stroke-rose-300' : row.tone === 'idle' ? 'stroke-slate-400' : 'stroke-emerald-300'}
                      fillClassName={row.tone === 'error' ? 'fill-rose-400/10' : row.tone === 'idle' ? 'fill-slate-400/10' : 'fill-emerald-400/10'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
