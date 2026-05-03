import React from 'react';
import { LLMUsageChart, StatCard, TopBar } from '@/components/ui';
import { getIntelligenceContent } from '@/lib/command-center-data';
import { getRouteMeta } from '@/lib/command-center-nav';

export default async function IntelligencePage() {
  const meta = getRouteMeta('/intelligence');
  const content = await getIntelligenceContent();

  return (
    <div className="space-y-6">
      <TopBar
        eyebrow={meta.eyebrow}
        title={meta.label}
        description={meta.description}
        liveLabel={meta.liveLabel}
        liveValue={content.usage.reduce((sum, row) => sum + row.requests, 0)}
        chips={[
          { label: 'score bands', value: `${content.scoreBands.length}` },
          { label: 'warnings', value: `${content.warnings.length}` },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {content.metrics.map((metric) => (
          <StatCard key={metric.label} label={metric.label} value={metric.value} delta={metric.delta} unit={metric.unit} liveUpdate />
        ))}
      </div>

      <div className="cc-grid-12">
        <section className="cc-panel lg:col-span-7">
          <div>
            <div className="cc-kicker">LLM usage</div>
            <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Model economics at a glance</h2>
          </div>
          <div className="mt-5">
            <LLMUsageChart rows={content.usage} />
          </div>
        </section>

        <section className="cc-panel lg:col-span-5">
          <div>
            <div className="cc-kicker">Score quality</div>
            <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Band performance</h2>
          </div>
          <div className="mt-5 space-y-3">
            {content.scoreBands.map((band) => (
              <article key={band.range} className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="font-medium text-[var(--cc-text-primary)]">{band.range}</div>
                  <div className="text-sm text-[var(--cc-text-secondary)]">{band.total} picks</div>
                </div>
                <div className="mt-3 flex gap-6 text-sm text-[var(--cc-text-secondary)]">
                  <span>{band.hitRatePct.toFixed(1)}% hit</span>
                  <span>{band.roiPct.toFixed(1)}% ROI</span>
                </div>
              </article>
            ))}
            {content.warnings.map((warning) => (
              <article key={warning.segment} className="rounded-[1.4rem] border border-[rgba(251,191,36,0.24)] bg-[rgba(251,191,36,0.08)] p-4">
                <div className="font-medium text-[var(--cc-text-primary)]">{warning.segment}</div>
                <div className="mt-2 text-sm text-[var(--cc-text-secondary)]">{warning.message}</div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
