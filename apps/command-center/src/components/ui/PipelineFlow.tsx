'use client';

import React from 'react';

export interface PipelineStage {
  name: string;
  count: number;
  status: 'healthy' | 'idle' | 'error';
}

export interface PipelineFlowProps {
  stages: PipelineStage[];
}

function connectorClass(status: PipelineStage['status']) {
  if (status === 'error') return 'border-rose-400/70';
  if (status === 'idle') return 'border-slate-600/70';
  return 'border-sky-400/60';
}

function ringClass(status: PipelineStage['status']) {
  if (status === 'error') return 'bg-rose-400';
  if (status === 'idle') return 'bg-slate-500';
  return 'bg-emerald-400';
}

export function PipelineFlow({ stages }: PipelineFlowProps) {
  return (
    <div className="cc-surface overflow-x-auto p-5">
      <div className="flex min-w-max items-center gap-3">
        {stages.map((stage, index) => {
          const healthy = stage.status === 'healthy';
          const isError = stage.status === 'error';

          return (
            <div key={`${stage.name}-${index}`} className="flex items-center gap-3">
              <div className="relative min-w-[156px] rounded-[22px] border border-[var(--cc-border-subtle)] bg-[color-mix(in_srgb,var(--cc-bg-surface-elevated)_86%,transparent)] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--cc-text-muted)]">{stage.name}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--cc-text-primary)]">{stage.count}</p>
                  </div>
                  <span className="relative mt-1 inline-flex h-3 w-3">
                    <span className={`absolute inset-0 rounded-full ${ringClass(stage.status)} opacity-80`} />
                    {healthy ? <span className={`absolute inset-0 rounded-full ${ringClass(stage.status)} animate-[cc-stage-ring_1.6s_ease-out_infinite]`} /> : null}
                  </span>
                </div>
                <div className="mt-3 text-xs capitalize text-[var(--cc-text-secondary)]">{stage.status}</div>
              </div>

              {index < stages.length - 1 ? (
                <div
                  aria-hidden="true"
                  className={`relative h-px w-24 border-t-2 ${connectorClass(stage.status)} ${isError ? 'border-dashed' : 'border-solid'}`}
                >
                  {healthy ? (
                    <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.95)] animate-[cc-travel_2.2s_linear_infinite]" />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
