import React from 'react';
import { DegradedState, EventStream, StatCard } from '@/components/ui';
import { getEventsContent } from '@/lib/command-center-data';

export const metadata = { title: 'Events — Unit Talk Command Center' };

export default async function EventsPage() {
  const content = await getEventsContent();

  if (!content) {
    return (
      <DegradedState
        severity="warning"
        title="Event replay unavailable"
        causes={['Submission-event truth could not be loaded. No event counts were inferred.']}
        action={{ label: 'System Health', href: '/api-health' }}
      />
    );
  }

  return (
    <div className="space-y-6">
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
