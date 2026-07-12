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
  const maxCount = Math.max(...stages.map((s) => s.count), 1);
  return (
    <div className="cc-surface overflow-x-auto p-5">
      <div className="flex min-w-max items-center gap-3">
        {stages.map((stage, index) => {
          const healthy = stage.status === 'healthy';
          const isError = stage.status === 'error';

          return (
            <div key={`${stage.name}-${index}`} className="flex items-center gap-3">
              <div
                className={`relative min-w-[156px] rounded-[22px] border px-4 py-3 ${
                  isError
                    ? 'border-rose-500/50 bg-rose-950/20 shadow-[0_0_24px_-8px_rgba(244,63,94,0.45)]'
                    : 'border-[var(--cc-border-subtle)] bg-[color-mix(in_srgb,var(--cc-bg-surface-elevated)_86%,transparent)]'
                }`}
              >
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
                <div className={`mt-3 text-xs capitalize ${isError ? 'font-semibold text-rose-300' : 'text-[var(--cc-text-secondary)]'}`}>
                  {isError ? 'flow broken' : stage.status}
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.05]" aria-hidden="true">
                  <div
                    className={`h-full rounded-full ${isError ? 'bg-rose-400/80' : stage.status === 'idle' ? 'bg-slate-500/70' : 'bg-sky-400/80'}`}
                    style={{ width: `${Math.max(stage.count > 0 ? 4 : 0, Math.round((stage.count / maxCount) * 100))}%` }}
                  />
                </div>
              </div>

              {index < stages.length - 1 ? (
                <div
                  aria-hidden="true"
                  className={`relative h-px w-24 border-t-2 ${connectorClass(stage.status)} ${isError ? 'border-dashed' : 'border-solid'}`}
                >
                  {healthy ? (
                    <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.95)] animate-[cc-travel_2.2s_linear_infinite]" />
                  ) : null}
                  {isError ? (
                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-rose-400/70 bg-[var(--cc-bg-canvas)] px-1 text-[10px] font-bold leading-4 text-rose-300">
                      ✕
                    </span>
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
