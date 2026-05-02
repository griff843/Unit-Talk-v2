import React from 'react';
import { EventStream, StatCard, TopBar } from '@/components/ui';
import { getOpsContent } from '@/lib/command-center-data';
import { getRouteMeta } from '@/lib/command-center-nav';

export default async function OpsPage() {
  const meta = getRouteMeta('/ops');
  const content = await getOpsContent();

  return (
    <div className="space-y-6">
      <TopBar
        eyebrow={meta.eyebrow}
        title={meta.label}
        description={meta.description}
        liveLabel={meta.liveLabel}
        liveValue={content.controls.length}
        chips={[
          { label: 'interventions', value: `${content.metrics[0]?.value ?? 0}` },
          { label: 'manual overrides', value: `${content.metrics[1]?.value ?? 0}` },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {content.metrics.map((metric) => (
          <StatCard key={metric.label} label={metric.label} value={metric.value} delta={metric.delta} unit={metric.unit} liveUpdate />
        ))}
      </div>

      <div className="cc-grid-12">
        <section className="cc-panel lg:col-span-5">
          <div>
            <div className="cc-kicker">Emergency controls</div>
            <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Guardrails and owners</h2>
          </div>
          <div className="mt-5 space-y-3">
            {content.controls.map((control) => (
              <article key={control.label} className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="font-medium text-[var(--cc-text-primary)]">{control.label}</div>
                  <div className="text-xs uppercase tracking-[0.18em] text-[var(--status-info-fg)]">{control.state}</div>
                </div>
                <div className="mt-2 text-sm text-[var(--cc-text-secondary)]">Owner: {control.owner}</div>
              </article>
            ))}
          </div>
        </section>

        <section className="cc-panel lg:col-span-7">
          <div>
            <div className="cc-kicker">Audit stream</div>
            <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Recent operator interventions</h2>
          </div>
          <div className="mt-5">
            <EventStream items={content.audit} />
          </div>
        </section>
      </div>
    </div>
  );
}
