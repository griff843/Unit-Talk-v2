import React from 'react';
import { HealthBadge, PipelineFlow, StatCard, TopBar } from '@/components/ui';
import { getApiHealthContent } from '@/lib/command-center-data';
import { getRouteMeta } from '@/lib/command-center-nav';

export default async function ApiHealthPage() {
  const meta = getRouteMeta('/api-health');
  const content = await getApiHealthContent();

  return (
    <div className="space-y-6">
      <TopBar
        eyebrow={meta.eyebrow}
        title={meta.label}
        description={meta.description}
        liveLabel={meta.liveLabel}
        liveValue={content.metrics[0]?.value ?? 0}
        chips={[
          { label: 'stale feeds', value: `${content.metrics[1]?.value ?? 0}` },
          { label: 'cycle blockers', value: `${content.metrics[3]?.value ?? 0}` },
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
            <div className="cc-kicker">Provider matrix</div>
            <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Freshness and volume</h2>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="cc-table min-w-full">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>24h rows</th>
                  <th>Freshness</th>
                </tr>
              </thead>
              <tbody>
                {content.providers.map((provider) => (
                  <tr key={provider.providerKey}>
                    <td className="font-medium text-[var(--cc-text-primary)]">{provider.providerKey}</td>
                    <td><HealthBadge status={provider.status} /></td>
                    <td className="text-sm text-[var(--cc-text-secondary)]">{provider.last24hRows}</td>
                    <td className="text-sm text-[var(--cc-text-secondary)]">
                      {provider.minutesSinceLastSnapshot != null ? `${provider.minutesSinceLastSnapshot}m ago` : 'No snapshot'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="cc-panel lg:col-span-5">
          <div>
            <div className="cc-kicker">Cycle lanes</div>
            <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Staging integrity</h2>
          </div>
          <div className="mt-5">
            <PipelineFlow stages={content.cycle} />
          </div>
        </section>
      </div>
    </div>
  );
}
