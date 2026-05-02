import React from 'react';
import { HealthBadge } from './HealthBadge';

export interface PipelineFlowStage {
  key: string;
  label: string;
  status: 'healthy' | 'warning' | 'error' | 'unknown';
  metric: string;
  detail: string;
}

const statusClasses: Record<PipelineFlowStage['status'], string> = {
  healthy: 'bg-[var(--status-success-fg)]',
  warning: 'bg-[var(--status-warning-fg)]',
  error: 'bg-[var(--status-error-fg)]',
  unknown: 'bg-[var(--status-info-fg)]',
};

export function PipelineFlow({ stages }: { stages: PipelineFlowStage[] }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[repeat(4,minmax(0,1fr))]">
        {stages.map((stage, index) => (
          <article key={stage.key} className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-5">
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(180,155,255,0.7),transparent)]" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.26em] text-[var(--cc-text-muted)]">Stage {index + 1}</div>
                <div className="mt-2 text-lg font-semibold text-[var(--cc-text-primary)]">{stage.label}</div>
              </div>
              <span className={`inline-flex h-3 w-3 rounded-full ${statusClasses[stage.status]} shadow-[0_0_24px_currentColor]`} />
            </div>
            <div className="mt-6 flex items-end justify-between gap-3">
              <div className="font-[family:var(--font-display)] text-3xl tracking-[-0.06em] text-[var(--cc-text-primary)]">
                {stage.metric}
              </div>
              <HealthBadge status={stage.status} />
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--cc-text-secondary)]">{stage.detail}</p>
          </article>
        ))}
      </div>

      <div className="hidden items-center gap-3 xl:flex" aria-hidden="true">
        {stages.map((stage, index) => (
          <div key={`${stage.key}-connector`} className="flex flex-1 items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${statusClasses[stage.status]}`} />
            {index < stages.length - 1 ? (
              <div className="relative h-px flex-1 overflow-hidden bg-white/10">
                <div className="absolute inset-y-0 left-0 w-24 animate-[pipeline-travel_2.2s_linear_infinite] bg-[linear-gradient(90deg,transparent,rgba(180,155,255,0.92),transparent)]" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
