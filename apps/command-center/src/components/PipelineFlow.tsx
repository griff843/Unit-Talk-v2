import { formatDurationMs, formatPipelineStatusLabel, type PipelineStageViewModel } from '@/lib/pipeline-health';

const CONNECTOR_CLASSES = {
  healthy: 'pipeline-connector pipeline-connector-healthy',
  warning: 'pipeline-connector pipeline-connector-warning',
  error: 'pipeline-connector pipeline-connector-error',
  idle: 'pipeline-connector pipeline-connector-idle',
} as const;

const DOT_CLASSES = {
  healthy: 'pipeline-stage-dot pipeline-stage-dot-healthy',
  warning: 'pipeline-stage-dot pipeline-stage-dot-warning',
  error: 'pipeline-stage-dot pipeline-stage-dot-error',
  idle: 'pipeline-stage-dot pipeline-stage-dot-idle',
} as const;

interface PipelineFlowProps {
  stages: PipelineStageViewModel[];
}

export function PipelineFlow({ stages }: PipelineFlowProps) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[920px] items-start gap-3 py-2">
        {stages.map((stage, index) => (
          <div key={stage.key} className="flex flex-1 items-center gap-3">
            <div className="min-w-0 flex-1 rounded-2xl border border-gray-800 bg-gray-950/80 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className={DOT_CLASSES[stage.status]} aria-hidden="true" />
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.28em] text-gray-500">{stage.label}</div>
                      <div className="text-sm font-semibold text-gray-100">{formatPipelineStatusLabel(stage.status)}</div>
                    </div>
                  </div>
                  <p className="max-w-[190px] text-xs leading-5 text-gray-400">{stage.detail}</p>
                </div>

                <div className="space-y-2 text-right">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Items</div>
                    <div className="text-2xl font-semibold text-gray-100">{stage.count}</div>
                  </div>
                  <div className="text-xs text-gray-500">Lag {formatDurationMs(stage.lagMs)}</div>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 text-[11px] text-gray-500">
                <span className="rounded-full border border-gray-800 bg-gray-900 px-2 py-1">
                  Errors {stage.errorCount}
                </span>
                <span className="rounded-full border border-gray-800 bg-gray-900 px-2 py-1">
                  Warnings {stage.warningCount}
                </span>
              </div>
            </div>

            {index < stages.length - 1 && (
              <div className="flex w-20 flex-none justify-center">
                <div className={CONNECTOR_CLASSES[stage.status]} aria-hidden="true">
                  <span className="pipeline-travel-dot" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
