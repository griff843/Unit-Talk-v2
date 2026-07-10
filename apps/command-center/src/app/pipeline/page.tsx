import React from 'react';
import { PipelineFlow, StatCard } from '@/components/ui';
import { getPipelineContent } from '@/lib/command-center-data';
import { getDashboardData, getDashboardRuntimeData } from '@/lib/data';
import { buildPipelineStages } from '@/lib/pipeline-stages';

export const metadata = { title: "Today's Action — Unit Talk Command Center" };

function SectionHeader({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--cc-text-muted)]">{kicker}</div>
      <h2 className="mt-1 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--cc-text-primary)]">{title}</h2>
    </div>
  );
}

export default async function PipelinePage() {
  // Fail closed but never 500: transient telemetry timeouts degrade to an
  // explicit banner instead of crashing the surface.
  const [content, dashboard] = await Promise.all([
    getPipelineContent(),
    Promise.all([getDashboardData(), getDashboardRuntimeData()]).catch(() => null),
  ]);

  // Same source as the Executive Overview stage strip — counts cannot diverge.
  const stages = dashboard ? buildPipelineStages(dashboard[0], dashboard[1]) : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold text-gray-100">Today&apos;s Action</h1>
        <p className="text-sm text-gray-500">
          Live pipeline posture — stage flow, backlog pressure, and promotion staging from current runtime telemetry.
        </p>
      </div>

      {content === null ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-semibold">Pipeline telemetry unavailable</div>
          <p className="mt-1 text-xs opacity-85">
            The pipeline-health snapshot could not be read. Stage flow below still reflects live dashboard signals; backlog
            and promotion detail will return when the snapshot source recovers.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {content.metrics.map((metric) => (
            <StatCard key={metric.label} label={metric.label} value={metric.value} delta={metric.delta} unit={metric.unit} liveUpdate />
          ))}
        </div>
      )}

      <section className="cc-surface space-y-4 p-5">
        <SectionHeader kicker="Stage flow" title="Ingest through publish" />
        {stages === null ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            Stage-flow signals unavailable (dashboard telemetry read failed). No counts are shown rather than stale or
            fabricated ones.
          </div>
        ) : (
          <PipelineFlow stages={stages} />
        )}
      </section>

      {content !== null && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="cc-surface p-5">
            <SectionHeader kicker="Backlog pressure" title="Queues to watch" />
            <div className="mt-5 space-y-3">
              {content.backlog.length === 0 && (
                <p className="text-sm text-gray-500">No backlog buckets tracked right now.</p>
              )}
              {content.backlog.map((row) => (
                <article key={row.label} className="rounded-2xl border border-gray-800 bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium text-[var(--cc-text-primary)]">{row.label}</div>
                      <div className="mt-1 text-sm text-[var(--cc-text-secondary)]">{row.detail}</div>
                    </div>
                    <div className="font-mono text-2xl font-semibold text-[var(--cc-text-primary)]">{row.count}</div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="cc-surface p-5">
            <SectionHeader kicker="Promotion lanes" title="Release staging" />
            <div className="mt-5 space-y-3">
              {content.promotion.length === 0 && (
                <p className="text-sm text-gray-500">No promotion lanes active.</p>
              )}
              {content.promotion.map((row) => (
                <article key={row.label} className="rounded-2xl border border-gray-800 bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium text-[var(--cc-text-primary)]">{row.label}</div>
                      <div className="mt-1 text-sm text-[var(--cc-text-secondary)]">{row.detail}</div>
                    </div>
                    <div className="font-mono text-2xl font-semibold text-[var(--cc-text-primary)]">{row.count}</div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
