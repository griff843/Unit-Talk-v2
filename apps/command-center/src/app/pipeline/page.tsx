import { PipelineFlow } from '@/components/PipelineFlow';
import { PipelineLiveRefresh } from '@/components/PipelineLiveRefresh';
import { MiniSparkline } from '@/components/MiniSparkline';
import { Card } from '@/components/ui/Card';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { getPipelineHealthSnapshot } from '@/lib/data/pipeline-health';
import { formatDurationMs, formatPipelineStatusLabel, type PipelineHealthRow } from '@/lib/pipeline-health';

function metricTone(direction: PipelineHealthRow['direction']) {
  switch (direction) {
    case 'up':
      return 'text-emerald-300';
    case 'down':
      return 'text-red-300';
    default:
      return 'text-gray-400';
  }
}

function metricArrow(direction: PipelineHealthRow['direction']) {
  switch (direction) {
    case 'up':
      return 'Up';
    case 'down':
      return 'Down';
    default:
      return 'Flat';
  }
}

export default async function PipelinePage() {
  const snapshot = await getPipelineHealthSnapshot();

  return (
    <div className="flex flex-col gap-6">
      <PipelineLiveRefresh config={snapshot.liveConfig} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-[0.28em] text-gray-500">Section 3</div>
          <h1 className="text-xl font-semibold text-gray-100">Pipeline System Health</h1>
          <p className="max-w-3xl text-sm text-gray-400">
            End-to-end health for intake, normalization, grading, promotion, and publish flow.
          </p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={snapshot.observedAt} className="lg:min-w-[360px]" />
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        <Card title="Overall Health">
          <div className="space-y-2">
            <div className="text-3xl font-semibold text-gray-100">{formatPipelineStatusLabel(snapshot.overallStatus)}</div>
            <p className="text-sm text-gray-400">
              {snapshot.errorCount > 0
                ? `${snapshot.errorCount} active error condition(s) are affecting the pipeline.`
                : 'No active pipeline errors are visible in the current snapshot.'}
            </p>
          </div>
        </Card>

        <Card title="Items In Flight">
          <div className="space-y-2">
            <div className="text-3xl font-semibold text-gray-100">{snapshot.itemsInFlight}</div>
            <p className="text-sm text-gray-400">Current work visible across all five stages.</p>
          </div>
        </Card>

        <Card title="Error Count">
          <div className="space-y-2">
            <div className="text-3xl font-semibold text-gray-100">{snapshot.errorCount}</div>
            <p className="text-sm text-gray-400">Failed delivery rows and stage-level error conditions.</p>
          </div>
        </Card>

        <Card title="Avg Throughput">
          <div className="space-y-2">
            <div className="text-3xl font-semibold text-gray-100">{snapshot.averageThroughputPerHour}/hr</div>
            <p className="text-sm text-gray-400">Average materialized-to-published throughput over the last six hours.</p>
          </div>
        </Card>
      </div>

      <Card title="Stage Flow">
        <PipelineFlow stages={snapshot.stages} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr_1fr]">
        <Card title="Pipeline Lag Per Stage">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-[11px] uppercase tracking-[0.24em] text-gray-500">
                  <th className="pb-2 pr-4">Stage</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Lag</th>
                  <th className="pb-2">Trend</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.stages.map((stage) => (
                  <tr key={stage.key} className="border-b border-gray-900 last:border-b-0">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-gray-100">{stage.label}</div>
                      <div className="text-xs text-gray-500">{stage.detail}</div>
                    </td>
                    <td className="py-3 pr-4 text-gray-300">{formatPipelineStatusLabel(stage.status)}</td>
                    <td className="py-3 pr-4 text-gray-100">{formatDurationMs(stage.lagMs)}</td>
                    <td className="py-3 text-sky-300">
                      <MiniSparkline values={stage.lagTrend} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Backlog Count">
          <div className="space-y-3">
            {snapshot.backlogRows.map((row) => (
              <div key={row.label} className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-100">{row.label}</div>
                    <div className="mt-1 text-xs text-gray-500">{row.detail}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-semibold text-gray-100">{row.count}</div>
                    <div className={`text-xs ${metricTone(row.direction)}`}>{metricArrow(row.direction)}</div>
                  </div>
                </div>
                <div className="mt-3 text-sky-300">
                  <MiniSparkline values={row.trend} className="h-10 w-full" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Promotion Queue Depth">
          <div className="space-y-3">
            {snapshot.promotionQueueRows.map((row) => (
              <div key={row.label} className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-100">{row.label}</div>
                    <div className="mt-1 text-xs text-gray-500">{row.detail}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-semibold text-gray-100">{row.count}</div>
                    <div className={`text-xs ${metricTone(row.direction)}`}>{metricArrow(row.direction)}</div>
                  </div>
                </div>
                <div className="mt-3 text-amber-300">
                  <MiniSparkline values={row.trend} className="h-10 w-full" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
