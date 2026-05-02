import React from 'react';
import { EventStream, PipelineFlow, StatCard, TopBar } from '@/components/ui';
import { getOverviewContent } from '@/lib/command-center-data';
import { getRouteMeta } from '@/lib/command-center-nav';

export default async function DashboardPage() {
  const meta = getRouteMeta('/');
  const content = await getOverviewContent();

  return (
    <div className="space-y-6">
      <TopBar
        eyebrow={meta.eyebrow}
        title={meta.label}
        description={meta.description}
        liveLabel={meta.liveLabel}
        liveValue={content.metrics[2]?.value ?? 0}
        chips={content.focus.map((item) => ({ label: item.label, value: item.value }))}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {content.metrics.map((metric) => (
          <StatCard key={metric.label} label={metric.label} value={metric.value} delta={metric.delta} unit={metric.unit} liveUpdate />
        ))}
      </div>

      <section className="cc-panel space-y-4">
        <div>
          <div className="cc-kicker">Pipeline status band</div>
          <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">From intake to publish</h2>
        </div>
        <PipelineFlow stages={content.pipeline} />
      </section>

      <div className="cc-grid-12">
        <section className="cc-panel space-y-4 lg:col-span-7">
          <div>
            <div className="cc-kicker">Event stream</div>
            <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Latest operator-visible events</h2>
          </div>
          <EventStream items={content.events} />
        </section>

        <section className="cc-panel space-y-4 lg:col-span-5">
          <div>
            <div className="cc-kicker">Focus board</div>
            <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">What matters next</h2>
          </div>
          <div className="space-y-3">
            {content.focus.map((item) => (
              <article key={item.label} className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--cc-text-muted)]">{item.label}</div>
                <div className="mt-2 text-lg font-semibold text-[var(--cc-text-primary)]">{item.value}</div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
