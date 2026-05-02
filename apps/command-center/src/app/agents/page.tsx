import React from 'react';
import { AgentCard, StatCard, TopBar } from '@/components/ui';
import { getAgentsContent } from '@/lib/command-center-data';
import { getRouteMeta } from '@/lib/command-center-nav';

export default async function AgentsPage() {
  const meta = getRouteMeta('/agents');
  const content = await getAgentsContent();

  return (
    <div className="space-y-6">
      <TopBar
        eyebrow={meta.eyebrow}
        title={meta.label}
        description={meta.description}
        liveLabel={meta.liveLabel}
        liveValue={content.metrics[0]?.value ?? 0}
        chips={[
          { label: 'busy', value: `${content.metrics[1]?.value ?? 0}` },
          { label: 'review handoffs', value: `${content.metrics[2]?.value ?? 0}` },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {content.metrics.map((metric) => (
          <StatCard key={metric.label} label={metric.label} value={metric.value} delta={metric.delta} unit={metric.unit} liveUpdate />
        ))}
      </div>

      <div className="cc-grid-12">
        <section className="cc-panel lg:col-span-8">
          <div>
            <div className="cc-kicker">Roster</div>
            <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Execution network</h2>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {content.roster.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>

        <section className="cc-panel lg:col-span-4">
          <div>
            <div className="cc-kicker">Operator notes</div>
            <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--cc-text-primary)]">Why the network looks like this</h2>
          </div>
          <div className="mt-5 space-y-3">
            {content.notes.map((note) => (
              <article key={note.title} className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
                <div className="font-medium text-[var(--cc-text-primary)]">{note.title}</div>
                <div className="mt-2 text-sm text-[var(--cc-text-secondary)]">{note.detail}</div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
