import React from 'react';
import { PipelineFlow, StatCard, TopBar } from '@/components/ui';
import { getPipelineContent } from '@/lib/command-center-data';
import { getRouteMeta } from '@/lib/command-center-nav';

export default async function PipelinePage() {
  const meta = getRouteMeta('/pipeline');
  const content = await getPipelineContent();

  return (
    <div className="space-y-6">
      <TopBar
        eyebrow={meta.eyebrow}
        title={meta.label}
        description={meta.description}
        liveLabel={meta.liveLabel}
        liveValue={content.metrics[0]?.value ?? 0}
        chips={[
          { label: 'pressure', value: `${content.metrics[1]?.value ?? 0} errors` },
          { label: 'throughput', value: `${content.metrics[0]?.delta ?? 'n/a'}` },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {content.metrics.map((metric) => (
          <StatCard key={metric.label} label={metric.label} value={metric.value} delta={metric.delta} unit={metric.unit} liveUpdate />
        ))}
      </div>

      <section className="cc-panel space-y-4">
        <div>
          <div className="cc-kicker">Stage flow</div>
          <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Current lane posture</h2>
        </div>
        <PipelineFlow stages={content.pipeline} />
      </section>

      <div className="cc-grid-12">
        <section className="cc-panel lg:col-span-6">
          <div className="cc-kicker">Backlog pressure</div>
          <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Queues to watch</h2>
          <div className="mt-5 space-y-3">
            {content.backlog.map((row) => (
              <article key={row.label} className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-[var(--cc-text-primary)]">{row.label}</div>
                    <div className="mt-1 text-sm text-[var(--cc-text-secondary)]">{row.detail}</div>
                  </div>
                  <div className="font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">{row.count}</div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="cc-panel lg:col-span-6">
          <div className="cc-kicker">Promotion lanes</div>
          <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Release staging</h2>
          <div className="mt-5 space-y-3">
            {content.promotion.map((row) => (
              <article key={row.label} className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-[var(--cc-text-primary)]">{row.label}</div>
                    <div className="mt-1 text-sm text-[var(--cc-text-secondary)]">{row.detail}</div>
                  </div>
                  <div className="font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">{row.count}</div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
