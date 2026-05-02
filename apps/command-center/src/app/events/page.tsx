import React from 'react';
import { EventStream, StatCard, TopBar } from '@/components/ui';
import { getEventsContent } from '@/lib/command-center-data';
import { getRouteMeta } from '@/lib/command-center-nav';

export default async function EventsPage() {
  const meta = getRouteMeta('/events');
  const content = await getEventsContent();

  return (
    <div className="space-y-6">
      <TopBar
        eyebrow={meta.eyebrow}
        title={meta.label}
        description={meta.description}
        liveLabel={meta.liveLabel}
        liveValue={content.metrics[0]?.value ?? 0}
        chips={[
          { label: 'mode', value: 'replay ready' },
          { label: 'source', value: 'submission_events' },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {content.metrics.map((metric) => (
          <StatCard key={metric.label} label={metric.label} value={metric.value} delta={metric.delta} unit={metric.unit} liveUpdate />
        ))}
      </div>

      <section className="cc-panel space-y-4">
        <div>
          <div className="cc-kicker">Timeline</div>
          <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Readable event replay</h2>
        </div>
        <EventStream items={content.events} />
      </section>
    </div>
  );
}
